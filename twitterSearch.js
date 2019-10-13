/**
 * @fileoverview Functions implementing Twitter premium search
 * @author Joey Whelan <joey.whelan@gmail.com>
 */

'use strict';
'use esversion 6';
const fetch = require('node-fetch');
const btoa = require('btoa');
const fs = require('fs');
const fsp = fs.promises;

const CONSUMER_KEY = process.env.CONSUMER_KEY;  //twitter auth key
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;  //twitter auth secret
const THIRTY_DAY_LABEL = process.env.THIRTY_DAY_LABEL;  //url suffix for the twitter 30day premium search
const FULL_LABEL = process.env.FULL_LABEL; //url suffix for the twitter fullarchive premium search
const AUTH_URL = 'https://api.twitter.com/oauth2/token';  //url for fetching a twitter bearer token
const SEARCH_URL = 'https://api.twitter.com/1.1/tweets/search';  //url prefix for twitter premium search
const OUTFILE = './tweets.json';  //json-formatted file with the results from twitter premium search

/**
 * Function that implements a REST call to the Twitter premium search API
 * @param {string} token - twitter bearer token
 * @param {string} url - url to the twitter premium seach api.  Options are 30day or fullarchive
 * @param {string} query - twitter search operator
 * @param {string} fromDate - UTC timestamp for start date of twitter search
 * @param {string} maxResults - maximum number of tweet results to return
 * @param {string} next - identifier signifying an additional page of results is available
 * @return {promise} batch/page of tweets
 * @throws {Error} propagates HTTP status errors or node fetch exceptions
 */
async function getTweetBatch(token, url, query, fromDate, maxResults, next) {
    let ts = new Date();
    console.debug(`${ts.toISOString()} getTweetBatch - url:${url}, query:${query}`);

    const body = {
        'query' : query,
        'fromDate' : fromDate,
        'maxResults' : maxResults
    };
    if (next) {
        body.next = next;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
            'Authorization' : 'Bearer ' + token
            },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            const json = await response.json();
            return json;
        }
        else {
            let msg = (`authorization request response status: ${response.status}`);
            throw new Error(msg);    
        }
    }
    catch (err) {
        ts = new Date();
        let msg = (`${ts.toISOString()} getTweetBatch - query:${query} - ${err}`);
        console.error(msg);
        throw err;
    }
}

/**
* Fetches an app-only bearer token via Twitter's oauth2 interface
* @param {string} url- URL to Twitter's OAuth2 interface
* @return {string} - Bearer token
*/
async function getTwitterToken(url) {
    let ts = new Date();
    console.debug(`${ts.toISOString()} getTwitterToken - url:${url}`);
    const consumerToken = btoa(urlEncode(CONSUMER_KEY) + ':' + urlEncode(CONSUMER_SECRET));

    let response, json;

    try {
        
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization' : 'Basic ' + consumerToken,
                'Content-Type' : 'application/x-www-form-urlencoded;charset=UTF-8'
            }, 
            body : 'grant_type=client_credentials'
        });

        if (response.ok) {
            json = await response.json();
            return json.access_token;
        }
        else {
            let msg = (`response status: ${response.status}`);
            throw new Error(msg);
        }
    }
    catch (err) {
        ts = new Date();
        let msg = (`${ts.toISOString()} getTwitterToken - url:${url} - ${err}`);
        console.error(msg)
        throw err;
    } 
} 

/**
 * Function for implementing twitter premium search (30day or archive).  Loops on the 'next' page result
 * for searches that return more than maxResults
 * @param {string} url - url to the twitter premium seach api.  Options are 30day or fullarchive
 * @param {string} query - twitter search operator
 * @param {string} fromDate - UTC timestamp for start date of twitter search
 * @param {string} maxResults - maximum number of tweet results to return
 * @return {promise} array of tweets
 * @throws {Error} propagates HTTP status errors or node fetch exceptions
 */
async function search(url, query, fromDate, maxResults) {
    let ts = new Date();
    console.debug(`${ts.toISOString()} search - url:${url}, query:${query}`);
    let tweets = [];

    try {
        const token = await getTwitterToken(AUTH_URL);
        let next = null;
        
        do {
            const batch = await getTweetBatch(token, url, query, fromDate, maxResults, next);
            for (let i=0; i < batch.results.length; i++) {  //loop through the page/batch of results
                let tweet = {};
                if (batch.results[i].truncated) {  //determine if this is a 140 or 280 character tweet
                    tweet.text = batch.results[i].extended_tweet.full_text.trim();
                }
                else {
                    tweet.text = batch.results[i].text.trim();
                }

                tweet.text = tweet.text.replace(/\r?\n|\r|@|#/g, ' ');  //remove newlines, @ and # from tweet text
                tweet.created_at = batch.results[i].created_at;
                tweets.push(tweet);
            }
            next = batch.next;
            await rateLimiter(3);  //rate limit twitter api calls to 1 per 3 seconds/20 per minute
        }
        while (next);

        return tweets.length;
    }
    catch (err) {
        ts = new Date();
        let msg = (`${ts.toISOString()} search - url: ${url}, query:${query} - ${err}`);
        console.error(msg);
        throw err;
    }
    finally {
        await fsp.writeFile(OUTFILE, JSON.stringify(tweets, null, 4));
    }  
}

/**
 * Function for adding delay to Twitter api calls.  Implements a timer to pause execution via promisified call to setTimeout
 * @param {int} sec - number of seconds to delay
 * @return {promise} 
 */
async function rateLimiter(sec) {
    let ts = new Date();
    console.debug(`${ts.toISOString()} rateLimiter - sec:${sec}`);

    return new Promise((resolve) => {
        setTimeout(() => { 
            resolve();
        }, sec*1000);
    })
}

/**
* Function I found on stackoverflow for providing url encoding
* @param {string} str- string to be encoded
* @return {string} - url encoded string
*/
function urlEncode (str) {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A')
}

/**
* Simple function providing an async read of json-formatted file.
* @param {string} file- name of json-formatted file to be read
* @return {object} - json object
*/
async function readTweetFile(file) {
    let tweets = await fsp.readFile(file);
    return JSON.parse(tweets);
}


let query = 'from:realDonaldTrump -RT';  //get tweets originated from Donald Trump, filter out his retweets
let url = SEARCH_URL + THIRTY_DAY_LABEL;  //30day search
let fromDate = '201910010000'; //search for tweets within the current month (currently, Oct 2019)
search(url, query, fromDate, 100)  //100 is the max results per request for the sandbox environment 
.then(total => {
    console.log('total tweets: ' + total);
})
.catch(err => {
    console.error(err);
});

readTweetFile(OUTFILE)
.then(tweets => {
    console.log(JSON.stringify(tweets, null, 4));
});
