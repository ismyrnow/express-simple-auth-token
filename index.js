'use strict';
var jwt = require('jsonwebtoken');
var express = require('express');
var bodyParser = require('body-parser');
module.exports = expressJWT;

function expressJWT(rawOpts) {
  var opts = dealOpts(rawOpts);
  var middleware = express();
  var lookup = opts.lookup;
  var verify = opts.verify;
  var createToken = opts.createToken;
  var refreshLookup = opts.refreshLookup;
  var authError = opts.authError;
  var createTokenError = opts.createTokenError;
  var refreshTokenError = opts.refreshTokenError;
  middleware.post(opts.serverTokenEndpoint, bodyParser.urlencoded({ extended: true }), bodyParser.json(), function (req, res, next) {
    if (!req.body || !req.body[opts.identificationField] || !req.body[opts.passwordField]) {
      return createTokenError(req, res, next, new Error('Request body is missing some necessary fields'));
    }
    lookup.call(req, req.body[opts.identificationField], function (err, resp) {
      if (err) {
        return createTokenError(req, res, next, err);
      }
      verify.call(req, req.body[opts.passwordField], resp, function (err, verified) {
        if (err || !verified) {
          return createTokenError(req, res, next, err || new Error('Verification failed'));
        }
        createToken.call(req, resp, function (err, tokenData) {
          if (err) {
            return createTokenError(req, res, next, err);
          }
          var token = jwt.sign(tokenData, opts.secret, {
            expiresIn: opts.tokenLife * 60,
            algorithm: opts.algorithm
          });
          tokenData[opts.tokenPropertyName] = token;
          res.json(tokenData);
        });
      });
    });
  });

  middleware.post(opts.serverTokenRefreshEndpoint, bodyParser.urlencoded({ extended: true }), bodyParser.json(), function (req, res, next) {
    if (!req.body || !req.body[opts.tokenPropertyName]) {
      return refreshTokenError(req, res, next, new Error('Request body is missing some necessary fields'));
    }
    var token, expiredAt;
    try {
      token = jwt.verify(req.body[opts.tokenPropertyName], opts.secret, {
        algorithms: [
          opts.algorithm
        ]
      });
    } catch (err) {
      if (!opts.refreshLeeway || err.name !== 'TokenExpiredError') {
        return refreshTokenError(req, res, next, err);
      }
      try {
        expiredAt = err.expiredAt.getTime();
        if (typeof expiredAt !== 'number') {
          throw new Error('not a real experation date');
        }
        if (Date.now() - expiredAt < (1000 * opts.refreshLeeway)) {
          token = jwt.verify(req.body.token, opts.secret, {
            algorithms: [
              opts.algorithm
            ],
            ignoreExpiration: true
          });
        } else {
          throw err;
        }
      } catch(err){
        return refreshTokenError(req, res, next, err);
      }
    }
    refreshLookup.call(req, token, function (err, resp) {
      if (err) {
        return refreshTokenError(req, res, next, err);
      }
      createToken.call(req, resp, function (err, tokenData) {
        if (err) {
          return refreshTokenError(req, res, next, err);
        }
        var token = jwt.sign(tokenData, opts.secret, {
          expiresIn: opts.tokenLife * 60,
          algorithm: opts.algorithm
        });
        tokenData[opts.tokenPropertyName] = token;
        res.json(tokenData);
      });
    });
  });

  middleware.use(function (req, res, next) {
    if (req.headers[opts.authorizationHeaderName] &&
        req.headers[opts.authorizationHeaderName].length > opts.authorizationPrefix.length &&
        req.headers[opts.authorizationHeaderName].slice(0, opts.authorizationPrefix.length) === opts.authorizationPrefix) {
      try {
        req.user = jwt.verify(req.headers.authorization.slice(opts.authorizationPrefix.length), opts.secret, {
          algorithms: [
            opts.algorithm
          ]
        });
        return next();
      } catch(e) {
        return authError(req, res, next, e);
      }
    }
    authError(req, res, next, new Error('no token provided'));
  });
  return middleware;
}

function dealOpts(rawOpts) {
  if (!rawOpts) {
    throw new TypeError('options are not optional');
  }
  if (!rawOpts.secret) {
    throw new TypeError('must supply secret');
  }
  var out = {
    secret: '',
    algorithm: 'HS256',
    authError: function (req, res) {
      return res.sendStatus(401);
    },
    createTokenError: function (req, res) {
      return res.sendStatus(401);
    },
    refreshTokenError: function (req, res) {
      return res.sendStatus(401);
    },
    serverTokenEndpoint: '/api-token-auth',
    serverTokenRefreshEndpoint: '/api-token-refresh',
    identificationField: 'username',
    passwordField: 'password',
    tokenPropertyName: 'token',
    authorizationPrefix: 'Bearer ',
    authorizationHeaderName: 'Authorization',
    refreshLeeway: 0,
    tokenLife: 60,
    lookup: null,
    verify: null,
    createToken: function (user, callback) {
      process.nextTick(function () {
        callback(null, user);
      });
    }
  };
  Object.keys(out).forEach(function (key) {
    // change if there are options that can be falsy
    if (rawOpts[key]) {
      out[key] = rawOpts[key];
    }
  });
  if (!rawOpts.refreshLookup) {
    out.refreshLookup = function (user, callback) {
      if (!user[out.identificationField]) {
        return process.nextTick(function () {
          callback(new Error('no username in token'));
        });
      }
      var lookup = out.lookup;
      lookup(user[out.identificationField], callback);
    };
  } else {
    out.refreshLookup = rawOpts.refreshLookup;
  }
  ['lookup', 'verify', 'createToken', 'refreshLookup'].forEach(function (key) {
    if (typeof out[key] !== 'function') {
      throw new Error(key + ' must be a function');
    }
  });

  out.authorizationHeaderName = out.authorizationHeaderName.toLowerCase();
  out.serverTokenRefreshEndpoint = addSlash(out.serverTokenRefreshEndpoint);
  out.serverTokenRefreshEndpoint = addSlash(out.serverTokenRefreshEndpoint);
  return out;
}
function addSlash(string) {
  if (string[0] !== '/') {
    return '/' + string;
  }
  return string;
}
