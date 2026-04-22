"use strict";

function createDocument() {
  return {
    validationErrors: [],
    validate() {
      return true;
    }
  };
}

module.exports = {
  parseXml() {
    return createDocument();
  }
};
