// Shared Keygen API client. Every call goes through this instance so auth headers,
// the account-scoped base URL and the timeout live in one place.
const axios = require('axios');

const PAGE_SIZE = 100; // Keygen's maximum page size
// Upper bound on concurrent page requests when crawling a large collection, so a
// cold admin load doesn't flood a small self-hosted Keygen instance.
const PAGE_CONCURRENCY = 4;

const keygen = axios.create({
    baseURL: `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}`,
    // Without a timeout a hung Keygen request holds the browser's request open forever.
    timeout: 15000,
    headers: {
        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
    },
});

async function fetchPage(path, params, pageNumber) {
    const response = await keygen.get(path, {
        params: { ...params, 'page[size]': PAGE_SIZE, 'page[number]': pageNumber },
    });
    if (response.status !== 200) {
        throw Object.assign(new Error(`Failed to fetch ${path}`), { status: response.status });
    }
    return response.data;
}

// Fetches every page of a Keygen collection and returns the mapped rows.
// Page 1 tells us the total page count (links.meta.pages), so the remaining pages are
// fetched in parallel. If Keygen omits that count we fall back to walking pages one by
// one, stopping at the first short page rather than paying for a trailing empty one.
async function fetchAllPages(path, params, mapFn) {
    const first = await fetchPage(path, params, 1);
    const rows = (first?.data || []).map(mapFn);
    if (rows.length < PAGE_SIZE) return rows;

    const totalPages = Number(first?.links?.meta?.pages);
    if (Number.isInteger(totalPages) && totalPages > 1) {
        const pageNumbers = [];
        for (let page = 2; page <= totalPages; page++) pageNumbers.push(page);

        for (let i = 0; i < pageNumbers.length; i += PAGE_CONCURRENCY) {
            const batch = pageNumbers.slice(i, i + PAGE_CONCURRENCY);
            const pages = await Promise.all(batch.map(page => fetchPage(path, params, page)));
            for (const page of pages) rows.push(...(page?.data || []).map(mapFn));
        }
        return rows;
    }

    for (let page = 2; ; page++) {
        const data = (await fetchPage(path, params, page))?.data || [];
        rows.push(...data.map(mapFn));
        if (data.length < PAGE_SIZE) return rows;
    }
}

module.exports = { keygen, fetchAllPages };
