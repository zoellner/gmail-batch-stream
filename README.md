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
'use strict';

const _h = require('highland');
const GmailBatchStream = require('gmail-batch-stream');

// Setup Gmail Batch Stream
const GBS = new GmailBatchStream(process.env.ACCESS_TOKEN); //create new instance of GmailBatchStream with provided access token
const gmail = GBS.gmail(); //return pseudo gmail api client (drop-in replacement for official Gmail API client)

//create stream of message ids to be loaded (first page of messages.list)
const messageIdStream = _h([gmail.users.messages.list({userId: 'me'})])
.pipe(GBS.pipeline(1, 5))
.pluck('messages')
.sequence()
.pluck('id');

messageIdStream
.map(messageId => gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata' }))
.pipe(GBS.pipeline(100, 5)) //Run in batches of 100. Use quota of 5 (for users.messages.get).
.tap(_h.log)
.done(() => {
  console.log('done');
  process.exit();
});
```

## Acknowledgement
Inspired by [wapisasa/batchelor](https://github.com/wapisasa/batchelor) and [pradeep-mishra/google-batch](https://github.com/pradeep-mishra/google-batch).
