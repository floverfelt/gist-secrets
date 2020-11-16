const viewMoreFunc = () => {
    let minIId = Number.MAX_SAFE_INTEGER;
    $('div[iid]').each(function() {
        let iid = $(this).attr('iid')
        if(iid < minIId) {
            minIId = iid;
        }
    });
    window.location.href = '/home?start=' + (minIId - 1) + '&end=' + (minIId - 11)
}