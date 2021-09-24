// Server requirements
const express = require('express')
const axios = require('axios')
const fs = require('fs')
const fsExtra = require('fs-extra')
const path = require('path')
const shell = require('shelljs');
const Database = require('better-sqlite3')
const db = new Database('./db/gistsDb.db')
const {createLogger, format, transports} = require('winston');
const {combine, timestamp, label, printf} = format;

// Logging stuff
const formatter = printf(({level, message, timestamp}) => {
    return `${timestamp} ${level}: ${message}`;
});

const logger = createLogger({
    level: 'info',
    format: combine(timestamp(), formatter),
    transports: [
        new transports.Console(
            {level: 'info'}
        ),
        new transports.File(
            {filename: 'error.log', level: 'error'}
        ),
        new transports.File(
            {filename: 'combined.log'}
        )
    ]
});

// Github stuff
const github_access_token = process.argv[2]
const github_username = 'floverfelt'
const github_api_url = 'https://' + github_username + ':' + github_access_token + '@api.github.com';

// Express app setup
const app = express()
const port = 3000
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'))

// Generic sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// The secret scanner does not like log files :(
const EXCLUDED_FILE_TYPES = [
    "md",
    "rst",
    "ipynb",
    "markdown",
    "log"
]

// Query public gists every 5 seconds
async function backgroundExecution() {

    try { // Fetch last check date from DB
        const currentCheckDate = new Date().toISOString()
        const selectLastCheckStmt = db.prepare('select value from config where key=\'last_check\'')
        const selectLastCheckRow = selectLastCheckStmt.get()
        const lastCheckDate = selectLastCheckRow.value

        // Query public gists
        // https://docs.github.com/en/free-pro-team@latest/rest/reference/gists#list-public-gists
        // TODO: Add pagination, currently only fetching most recent 100 gists
        logger.info('Checking gists since: ' + lastCheckDate)
        const options = {
            method: 'GET',
            url: github_api_url + '/gists/public',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'floverfelt'
            },
            params: {
                since: lastCheckDate,
                per_page: 100,
                page: 1
            }
        }
        const publicGistsResponse = await axios(options)

        if (publicGistsResponse.status != 200) {
            throw 'Gist API responded in error: ' + publicGistsResponse.data
        }

        logger.info('API rate limits remaining: ' + publicGistsResponse.headers['x-ratelimit-remaining'])

        const publicGistsResponseBody = publicGistsResponse.data

        // Parse the response body
        for (let i = 0; i < publicGistsResponseBody.length; i++) {
            let gist_entry = publicGistsResponseBody[i]
            let files = gist_entry.files
            // Parse the files of each gist
            for (let fileName of Object.keys(files)) {
                let shouldSkipFile = false; // Exclude some files as they don't embed well
                for (let type in EXCLUDED_FILE_TYPES) {
                    let suffix = EXCLUDED_FILE_TYPES[type]
                    if (fileName.endsWith(`.${suffix}`)) {
                        shouldSkipFile = true
                        break
                    }
                }

                if (shouldSkipFile) {
                    continue
                }

                const fileEntry = files[fileName]
                const filename = fileEntry['filename']

                // This is some weird CI/CD service
                if (filename === 'Changed Paths') {
                    continue
                }

                const ext = path.extname(filename)

                // Fetch the raw file
                const rawFileResponse = await axios.get(fileEntry['raw_url'])
                if (rawFileResponse.status != 200) {
                    throw 'Error fetching raw file: ' + rawFileResponse.data
                }

                let rawFile = String(rawFileResponse.data)

                const pulledFileName = `./gists/gist${ext}`
                fs.writeFileSync(pulledFileName, rawFile)

                // Call python script
                const cmd = `./venv/bin/python3 detect-secrets.py ${pulledFileName}`
                const res = shell.exec(cmd, {silent: true})
                const resJson = JSON.parse(res)

                // If this is true, the file has a secret
                if (resJson.hasOwnProperty(pulledFileName)) {
                    let lineNums = []
                    resJson[pulledFileName].forEach(element => {
                        lineNums.push(element.line_number)
                    });

                    let gistId = gist_entry.id
                    let gistHtmlUrl = gist_entry.html_url
                    // Insert the gist
                    const insertGistStmt = db.prepare(`insert or ignore into gists(gist_id, html_url) values (?,?)`)
                    insertGistStmt.run(gistId, gistHtmlUrl)
                    logger.info('gist inserted (or ignored) with id ' + gistId)
                    const insertGistFilesStmt = db.prepare(`insert into gist_files(gist_id, file, line_nums) values (?,?,?)`)
                    insertGistFilesStmt.run(gistId, fileName, String(lineNums))
                    logger.info('file inserted: ' + fileName)

                }

                // Delete any files in the /gists/ folder
                fsExtra.emptyDirSync('./gists')

            }
        }

        // Finally, update db with new last check
        const updateLastCheck = db.prepare(`update config set value = ? where key = 'last_check'`);
        updateLastCheck.run(currentCheckDate)
        logger.info('updated last_check to: ' + currentCheckDate)


    } catch (err) {
        fsExtra.emptyDirSync('./gists') // Delete any files in the /gists/ folder
        logger.error(err)

    }

    try { // Sleep for 5 seconds, call self again
        await sleep(1000)
        backgroundExecution()
    } catch (err) { // This should never get hit
        logger.error(err)
    }
}

// Call the function first time, it executes recursively
backgroundExecution()


app.get('/', (req, res) => {
    res.redirect('/home')
});

app.get('/home', (req, res) => {

    const renderDefault = () => {
        const getLastGistInternalId = db.prepare(`select distinct internal_id from gists order by internal_id desc limit 1`);
        let lastInternalId = parseInt(getLastGistInternalId.get().internal_id);
        lastInternalId = lastInternalId - 10
        const getLastTenGists = db.prepare(`select distinct internal_id, gists.gist_id, file, line_nums from gists inner join gist_files on gists.gist_id = gist_files.gist_id where internal_id >= ? order by internal_id desc limit 10`);
        const gists = getLastTenGists.all(lastInternalId)
        res.render('index.ejs', {
            rows: gists,
            hasPrevious: false
        });
    }

    // Parse and validate query params
    const startReq = req.query['start'];
    const endReq = req.query['end'];
    if (startReq && endReq) { // Further validation
        const startReqNum = parseInt(startReq)
        const endReqNum = parseInt(endReq)

        if (isNaN(startReq) || isNaN(endReqNum)) {
            return renderDefault()
        }
        if ((endReqNum - startReq) > 10) {
            return renderDefault()
        }

        // Fetch the values
        const getGistsInRange = db.prepare(`select distinct internal_id, gists.gist_id, file, line_nums from gists inner join gist_files on gists.gist_id = gist_files.gist_id where internal_id >= ? and internal_id <= ? order by internal_id`)
        const gists = getGistsInRange.all(endReqNum, startReqNum)
        res.render('index.ejs', {
            rows: gists,
            hasPrevious: false
        });

    } else {
        renderDefault();
    }

});

app.get('/about', (req, res) => {
    res.render('about.ejs', {hasPrevious: false})
});

// Handle 404 - Keep this as a last route
app.use((req, res, next) => {
    res.status(404);
    res.render('404.ejs');
});

app.listen(port, () => {
    logger.info(`Example app listening at http://localhost:${port}`);
});
