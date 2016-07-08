/*
  The MIT License (MIT)
  Copyright (c) 2016 Andreas Zoellner
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
*/

/*
  This module is inspired by the batchelor module by wapisasa and the google-batch module by pradeep-mishra
  gmail-batch-stream follows the gmail batch specs at https://developers.google.com/gmail/api/guides/batch

*/

'use strict';

var request = require('request');
var queryString = require('query-string');
var parser = require('http-string-parser');
var Google = require('googleapis');
var _h = require('highland');
var debug = require('debug')('gmail-batch-stream');

var GmailBatchStream = function() {
  this.userQuota = 250;
  this.parallelRequests = 10;
};

GmailBatchStream.prototype.init = function(authClient, callback) {
  var _this = this;
  debug('Gmail Batch Stream initialized');
  authClient.getAccessToken(function(err, token) {
    if (err) {return callback(err);}
    if (!token) {return callback(new Error('can\'t get token from authClient'));}
    _this.token = token;
    return callback();
  });
};

// pseudo gmail api interface that returns the request options instead of executing the request
GmailBatchStream.prototype.gmail = function() {
  return Google.gmail({version: 'v1', auth: {
    request: function(options, callback) {
      return options;
    }}
  });
};

GmailBatchStream.prototype.pipeline = function(batchSize, quotaSize) {
  var _this = this;
  _this.batchSize = batchSize || 100;
  _this.quotaSize = quotaSize || 1;

  var mapToMultipartRequest = function(batch) {
    if (!Array.isArray(batch)) {
      batch = [batch];
    }
    var batchRequestOptions = {
      url: 'https://www.googleapis.com/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/mixed',
        Authorization: 'Bearer ' + _this.token
      },
      multipart: batch.map(function(request, index) {
        var multipartRequest = {
          'Content-Type': 'application/http',
          'Content-ID': '<item-' + index + '>', //mark request with index (used below to extract response id)
          body: request.method + ' ' + request.url + (Object.keys(request.qs).length ? '?' + queryString.stringify(request.qs) : '') + '\n'
        };

        if (request.method !== 'GET') {
          multipartRequest.body += 'Content-Type: application/json\n\n' + JSON.stringify(request.json, null, 2);
        }
        return multipartRequest;
      })
    };

    return batchRequestOptions;
  };

  var parseMultiPart = function(s) {
    return function(s) {
      var collect = '';
      var firstString = true;
      var boundary;
      return s.consume(function(err, x, push, next) {
        if (err) {
          push(err);
          next();
        } else if (x === _h.nil) {
          //check if remaining collect contains boundary marker. If it does, remove it is the last one.
          if (boundary && collect.indexOf(boundary) > -1) {
            // remove trailing line breaks, then remove last line if it is the boundary marker
            collect = collect.replace(/\s+$/g, '');
            var lines = collect.split('\r\n');
            var last = lines.pop();
            if (last.indexOf(boundary) > -1) {
              //last line contains boundary, return other lines
              collect = lines.join('\r\n');
            } else {
              //last line was not the boundary, add line back and return
              collect = lines.concat([last]).join('\r\n');
            }
          }

          if (collect && collect.length > 0 && collect.trim() !== '--') {
            //remaining part of collect is more than just the remainder -- after the last boundary
            push(null, collect);
          }

          push(null, _h.nil);
        } else {
          collect += x;
          if (firstString) {
            var lines = collect.split('\r\n');
            if (lines.length > 1) {
              firstString = false;
              boundary = lines[0];
              collect = collect.slice(boundary.length).replace(/^\s+/g, ''); //start after boundary, remove leading line break
            }
          } else {
            var index = collect.indexOf(boundary);
            while (index > -1) {
              var completeBlock = collect.slice(0, index);
              push(null, completeBlock);
              collect = collect.slice(index + boundary.length).replace(/^\s+/g, '');;
              index = collect.indexOf(boundary);
            }
          }

          next();
        }
      });
    };
  };

  //response has following format:
  // Content-Type: application/http
  // Content-ID: <response-item-x>
  //
  // HTTP/1.1 200 OK
  // ETag: String
  // Content-Type: application/json; charset=UTF-8
  // Date: Date
  // Expires: Date
  // Cache-Control: private, max-age=0
  // Content-Length: Number
  var parseHttpResponse = function(response) {
    var lines = response.split('\r\n');
    if (lines.length < 3) {
      return;
    }

    //the first three lines are the header, the rest has the format of a HTTP response
    var parsed = parser.parseResponse(lines.slice(3).join('\r\n'));
    var m = lines[1].match(/Content-ID: <response-item-(\d)>/); //extract id from Content-ID
    if (m && m.length > 1) {
      parsed.contentId = m[1];
    }
    if (parsed.body && parsed.body.indexOf('--batch') > 0) {
      debug('Invalid HTTP response', JSON.stringify(parsed.body));
      throw new Error('Invalid HTTP response');
    }
    return parsed;
  };

  var processingPipeline = function() {
    return _h.pipeline(
      _h.invoke('toString', ['utf8']),
      _h.through(parseMultiPart()),
      _h.map(parseHttpResponse),
      _h.map(function(doc) {
        if (!(doc && doc.statusCode && parseInt(doc.statusCode, 10) === 200)) {
          return null;
        }
        return doc && doc.body;
      }),
      _h.compact(),
      _h.map(JSON.parse)
    );
  };

  return _h.pipeline(
    _h.batch(_this.batchSize),
    _h.ratelimit(_this.userQuota / _this.quotaSize / _this.batchSize, 1000), //quota per user is 250 quota units/second
    _h.map(mapToMultipartRequest),
    _h.map(function(batch) {
      return _h(request(batch).pipe(processingPipeline()));
    }),
    _h.mergeWithLimit(_this.parallelRequests)
  );

};

module.exports = GmailBatchStream;
