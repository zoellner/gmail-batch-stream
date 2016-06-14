# Gmail Batch Stream
A Node.js module to create batch requests for the Gmail REST API and return them as [Highland.js](http://highlandjs.org) streams.

## Google API Batch Requests
The official Google API Node.js Client [google/google-api-nodejs-client](https://github.com/google/google-api-nodejs-client) is missing batch processing. For processing large amounts of email through the Gmail API, batch processing greatly improves the throughput.

## Issues, Features and Bugs
The module isn't very universal yet. Pull requests are welcome.
For issues, feature requests or bugs that need attention please use the [GitHub Issue Tracker](https://github.com/zoellner/gmail-batch-stream/issues).

## Installation

This library is distributed on `npm`. In order to add it as a dependency, run the following command:

``` sh
$ npm install gmail-batch-stream --save
```

You will also need the official Google APIs Node.js Client and Highland.js to run the example below.

``` sh
$ npm install googleapis --save
$ npm install highland --save
```

## Usage
Example: Take a stream of message ids and load message headers in batches of 100. Returning a stream of messages.

``` js
var _h = require('highland');
// Setup Google Auth Client
var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var authClient = new OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

authClient.setCredentials({
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN,
  expiry_date: true //hack to make sure token is refreshed when necessary
});

// Setup Gmail Batch Stream
var GBS = new GmailBatchStream(); //create new instance of GmailBatchStream
var gmail = GBS.gmail(); //return pseudo gmail api client (drop-in replacement for official Gmail API client)

var messageIdStream = _h([MESSAGEID1, MESSAGEID2]); //stream of message ids to be loaded

GBS.init(authClient, function(err) {
  messageIdStream
  .map(function(messageId) {
    return gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata' });
  })
  .pipe(GBS.pipeline(100, 1)) //Run in batches of 100. Use quota of 1 (for users.messages.get).
  .tap(_h.log)
  .done();
});
```

## Acknowledgement
Inspired by [wapisasa/batchelor](https://github.com/wapisasa/batchelor) and [pradeep-mishra/google-batch](https://github.com/pradeep-mishra/google-batch).
