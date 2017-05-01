'use strict';

module.exports = class RateLimiter {
  constructor(numRequests, timeFrame) {
    this.availableTokens = Math.floor(numRequests);
    this.delayTime = timeFrame;
    this.repeatTime = this.delayTime / numRequests;
    this.start = Date.now();
  }

  checkTokens(num, callback) {
    const _this = this;
    // console.log('check', _this.availableTokens, num, Date.now() - _this.start);
    if (_this.availableTokens >= num) {
      return _this.getTokens(num, callback);
    } else {
      //out of tokens, need to check again after a bit
      setTimeout(function() {
        _this.checkTokens(num, callback);
      }, _this.repeatTime);
    }
  }

  getTokens(num, callback) {
    const _this = this;
    // console.log('getm ', _this.availableTokens, num, _this.start);
    _this.availableTokens = _this.availableTokens - num;
    if (_this.availableTokens >= 0) {
      //return callback and add token back after delayTime
      setTimeout(function() {_this.availableTokens = _this.availableTokens + num;}, _this.delayTime);
      return callback();
    } else {
      _this.availableTokens = _this.availableTokens + num; //add tokens back since we didn't make a call
      return _this.checkTokens(num, callback);
    }
  }

  getToken(callback) {
    return _this.getTokens(1, callback);
  }

  checkToken(callback) {
    return _this.checkTokens(1, callback);
  }
};
