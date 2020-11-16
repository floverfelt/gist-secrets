// Server requirements
const express = require('express')
const axios = require('axios')
const Database = require('better-sqlite3')
const db = new Database('./db/gistsDb.db')

const github_access_token = 'oh-the-irony...'
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

// Query public gists every 5 seconds
async function backgroundExecution() {

    try {
        // Fetch last check date from DB
        const currentCheckDate = new Date().toISOString()
        const selectLastCheckStmt = db.prepare('select value from config where key=\'last_check\'')
        const selectLastCheckRow = selectLastCheckStmt.get()
        const lastCheckDate = selectLastCheckRow.value

        // Query public gists
        // https://docs.github.com/en/free-pro-team@latest/rest/reference/gists#list-public-gists
        // TODO: Add pagination, currently only fetching most recent 100 gists
        console.log('Checking gists since: ' + lastCheckDate)
        const options = { method: 'GET', url: github_api_url + '/gists/public', headers: { 
            'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'floverfelt'}, params: { since: lastCheckDate, per_page: 100, page: 1 }}
        const publicGistsResponse = await axios(options)

        if(publicGistsResponse.status != 200) {
            throw 'Gist API responded in error: ' + publicGistsResponse.data
        }

        console.log('API rate limits remaining: ' + publicGistsResponse.headers['x-ratelimit-remaining'])

        const publicGistsResponseBody = publicGistsResponse.data

        // Parse the response body
        for(let i=0; i < publicGistsResponseBody.length; i++) {
            let gist_entry = publicGistsResponseBody[i]
            let files = gist_entry.files
            // Parse the files of each gist
            for (let fileName of Object.keys(files)) {
                // Exclude some files as they don't embed well
                if (fileName.endsWith(".md") || fileName.endsWith(".rst") || fileName.endsWith(".ipynb") || fileName.endsWith(".markdown")) {
                    continue
                }
                const fileEntry = files[fileName]
                // Fetch the raw file
                const rawFileResponse = await axios.get(fileEntry['raw_url'])
                if (rawFileResponse.status != 200) {
                    throw 'Error fetching raw file: ' + rawFileResponse.data
                }
                let rawFile = String(rawFileResponse.data)
                // Lowercase and split the file into lines
                rawFile = rawFile.toLowerCase()
                let split_file = rawFile.split("\n")
                const regex = '(secret|password)'
                let lineNums = new Array()
                let hasSecret = false
                // Iterate and search each line for regex
                for(let j=0; j < split_file.length; j++) {
                    let line = split_file[j]
                    if(line.match(regex)) {
                        // Line nums in Git begin at 1
                        lineNums.push(j+1)
                        hasSecret = true
                    }
                }
                if(hasSecret) {
                    let gistId = gist_entry.id
                    let gistHtmlUrl = gist_entry.html_url
                    // Insert the gist
                    const insertGistStmt = db.prepare(`insert or ignore into gists(gist_id, html_url) values (?,?)`)
                    insertGistStmt.run(gistId, gistHtmlUrl)
                    console.log('gist inserted (or ignored) with id ' + gistId)
                    const insertGistFilesStmt = db.prepare(`insert into gist_files(gist_id, file, line_nums) values (?,?,?)`)
                    insertGistFilesStmt.run(gistId, fileName, String(lineNums))
                    console.log('file inserted: ' + fileName)
                }
            }
        }

        // Finally, update db with new last check
        const updateLastCheck = db.prepare(`update config set value = ? where key = 'last_check'`);
        updateLastCheck.run(currentCheckDate)
        console.log('updated last_check to: ' + currentCheckDate)
    } catch(err) {
        console.log(err)
    }

    try {
        // Sleep for 5 seconds, call self again
        await sleep(1000)
        backgroundExecution()
    } catch(err) {
        // This should never get hit
        console.log(err)
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
        res.render('index.ejs', { rows: gists, hasPrevious: false } );
    }

    // Parse and validate query params
    const startReq = req.query['start'];
    const endReq = req.query['end'];
    if(startReq && endReq) {

        // Further validation
        const startReqNum = parseInt(startReq)
        const endReqNum = parseInt(endReq)

        if(isNaN(startReq) || isNaN(endReqNum)) {
            return renderDefault() 
        }
        if((endReqNum - startReq) > 10) {
            return renderDefault()
        }

        // Fetch the values
        const getGistsInRange = db.prepare(`select distinct internal_id, gists.gist_id, file, line_nums from gists inner join gist_files on gists.gist_id = gist_files.gist_id where internal_id >= ? and internal_id <= ? order by internal_id`)
        const gists = getGistsInRange.all(endReqNum, startReqNum)
        res.render('index.ejs', { rows: gists, hasPrevious: false } );

    } else {
        renderDefault();
    }

});

app.get('/about', (req, res) => {
    res.render('about.ejs', { hasPrevious: false })
});

// Handle 404 - Keep this as a last route
app.use((req, res, next) => {
    res.status(404);
    res.render('404.ejs');
});

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});