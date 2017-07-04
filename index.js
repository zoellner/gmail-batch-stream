/*
  This module is inspired by the batchelor module by wapisasa and the google-batch module by pradeep-mishra
  gmail-batch-stream follows the gmail batch specs at https://developers.google.com/gmail/api/guides/batch

*/

'use strict';

const request = require('request');
const queryString = require('query-string');
const parser = require('http-string-parser');
const Google = require('googleapis');
const _h = require('highland');
const _ = require('lodash');
const debug = require('debug')('gmail-batch-stream');

const RateLimiter = require('./utils/rateLimiter');

const GmailBatchStream = function(accessToken, options) {
  //default quota is 25,000 queries per 100 sec per user
  const defaults = {
    userQuota: 25000,
    userQuotaTime: 100000,
    parallelRequests: 10
  };

  options = options || {};

  _.defaults(options, defaults);

  this.userQuota = options.userQuota;
  this.userQuotaTime = options.userQuotaTime;
  this.parallelRequests = options.parallelRequests;
  this.token = accessToken;
  this.rl = new RateLimiter(this.userQuota, this.userQuotaTime);
};

// init function is obsolete and will be removed in future versions
GmailBatchStream.prototype.init = function(authClient, callback) {
  const _this = this;
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
      request: options => options
    }
  });
};

GmailBatchStream.prototype.pipeline = function(batchSize, quotaSize, filterErrors) {
  const _this = this;
  _this.batchSize = batchSize || 100;
  _this.quotaSize = quotaSize || 1;
  _this.filterErrors = filterErrors || false;

  const mapToMultipartRequest = (batch) => {
    if (!Array.isArray(batch)) {
      batch = [batch];
    }
    const batchRequestOptions = {
      url: 'https://www.googleapis.com/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/mixed',
        Authorization: 'Bearer ' + _this.token //applies to each request in the batch
      },
      multipart: batch.map((request, index) => {
        const multipartRequest = {
          'Content-Type': 'application/http',
          'Content-ID': `<item-${index}>`, //mark request with index (used below to extract response id)
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

  const parseMultiPart = () => function(s) {
    let collect = '';
    let firstString = true;
    let boundary;
    return s.consume(function(err, x, push, next) {
      if (err) {
        push(err);
        next();
      } else if (x === _h.nil) {
        //check if remaining collect contains boundary marker. If it does, remove if it is the last line.
        if (boundary && collect.indexOf(boundary) > -1) {
          // remove trailing line breaks, then remove last line if it is the boundary marker
          collect = collect.replace(/\s+$/g, '');
          const lines = collect.split('\r\n');
          const last = lines.pop();
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
          const lines = collect.split('\r\n');
          if (lines.length > 1) {
            firstString = false;
            boundary = lines[0];
            collect = collect.slice(boundary.length).replace(/^\s+/g, ''); //start after boundary, remove leading line break
          }
        } else {
          let index = collect.indexOf(boundary);
          while (index > -1) {
            const completeBlock = collect.slice(0, index);
            push(null, completeBlock);
            collect = collect.slice(index + boundary.length).replace(/^\s+/g, '');
            index = collect.indexOf(boundary);
          }
        }

        next();
      }
    });
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
  const parseHttpResponse = function(response) {
    const lines = response.split('\r\n');
    if (lines.length < 3) {
      return;
    }

    //the first three lines are the header, the rest has the format of a HTTP response
    const parsed = parser.parseResponse(lines.slice(3).join('\r\n'));
    const m = lines[1].match(/Content-ID: <response-item-(\d)>/); //extract id from Content-ID
    if (m && m.length > 1) {
      parsed.contentId = m[1];
    }
    if (parsed.body && parsed.body.indexOf('--batch') > 0) {
      debug('Invalid HTTP response', JSON.stringify(parsed.body));
      throw new Error('Invalid HTTP response');
    }
    return parsed;
  };

  const processingPipeline = function(filterErrors) {
    return _h.pipeline(
      _h.invoke('toString', ['utf8']),
      _h.through(parseMultiPart()),
      _h.map(parseHttpResponse),
      _h.map(function(doc) {
        if (filterErrors && !(doc && doc.statusCode && parseInt(doc.statusCode, 10) === 200)) {
          return null;
        }
        const body = doc && doc.body;
        if (!body) {return null;}

        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          debug('Invalid JSON', body);
          if (filterErrors) {
            return null;
          }
          parsed.body = body;
          parsed.error = e.toString();
        }
        return parsed;
      }),
      _h.compact()
    );
  };

  return _h.pipeline(
    _h.batch(_this.batchSize),
    _h.flatMap(_h.wrapCallback(function(doc, callback) {
      _this.rl.getTokens(_this.quotaSize * _this.batchSize, () => callback(null, doc));
    })),
    _h.map(mapToMultipartRequest),
    _h.map(batch => _h(request(batch).pipe(processingPipeline(_this.filterErrors)))),
    _h.mergeWithLimit(_this.parallelRequests)
  );

};

module.exports = GmailBatchStream;
