'use strict';

module.exports = class RateLimiter {
  constructor(numRequests, timeFrame) {
    this.availableTokens = Math.floor(numRequests);
    this.delayTime = timeFrame;
    this.repeatTime = this.delayTime / numRequests;
  }

  checkToken(callback) {
    const _this = this;
    // console.log('check', _this.availableTokens, Date.now() - start);
    if (_this.availableTokens > 0) {
      return _this.getToken(callback);
    } else {
      //out of tokens, need to check again after a bit
      setTimeout(function() {
        _this.checkToken(callback);
      }, _this.repeatTime);
    }
  }

  getToken(callback) {
    const _this = this;
    if (--_this.availableTokens >= 0) {
      //return callback and add token back after delayTime
      setTimeout(function() {_this.availableTokens++;}, _this.delayTime);
      return callback();
    } else {
      _this.availableTokens++; //add token back since we didn't make a call
      _this.checkToken(callback);
    }
  }
};
