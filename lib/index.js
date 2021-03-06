'use strict';

const { connect } = require('./db');
const { Document } = require('./document');
const { EmbeddedDocument } = require('./embedded-document');
const { Client } = require('./clients');
const ClientRegistry = require('./clients/registry');
const DatabaseClient = require('./clients/client');

module.exports = {
  connect,
  Client,
  Document,
  EmbeddedDocument,
  ClientRegistry,
  DatabaseClient
};
