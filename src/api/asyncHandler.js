'use strict';
/** Encaminha rejeições de handlers async pro middleware de erro do Express (que não faz isso sozinho na v4) */
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
