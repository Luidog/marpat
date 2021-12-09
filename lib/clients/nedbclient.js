'use strict';

const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const Datastore = require('nedb');
const DatabaseClient = require('./client');

const urlToPath = function(url) {
  if (url.indexOf('nedb://') > -1) {
    return url.slice(7, url.length);
  }
  return url;
};

const getCollectionPath = function(dbLocation, collection) {
  if (dbLocation === 'memory') {
    return dbLocation;
  }
  return path.join(dbLocation, collection) + '.db';
};

const createCollection = function(collectionName, url, options) {
  if (url === 'memory') {
    return new Datastore({ inMemoryOnly: true });
  }
  const collectionPath = getCollectionPath(url, collectionName);
  return new Datastore({
    filename: collectionPath,
    ...options,
    autoload: true
  });
};

const getCollection = function(name, collections, path, options) {
  if (!(name in collections)) {
    const collection = createCollection(name, path, options);
    collections[name] = collection;
    return collection;
  }

  return collections[name];
};

/**
 * @class NeDbClient
 * @classdesc The class used to integrate with NEDB
 */
class NeDbClient extends DatabaseClient {
  /** @constructs
   * @param {String} url The mongodb connection url.
   * @param {Object} collections Collections to use in initial constuction
   * @param {Object} options The connection options.
   */
  constructor(url, collections = {}, options) {
    super(url);
    this._path = urlToPath(url);
    this._options = options || {};
    this._collections = collections;
  }

  /**
   * @method canHandle
   * @description tests a given url to see if the client can handle connection.
   * @param {String} url The url to test.
   * @return {Promise} Promise with result insert or update query
   */
  static canHandle(url) {
    return url.indexOf('nedb://') === 0;
  }

  /**
   * @method save
   * @description Save (upsert) document
   * @param {String} collection Collection's name
   * @param {ObjectId?} id Document's id
   * @param {Object} values Data for save
   * @return {Promise} Promise with result insert or update query
   */
  save(collection, id, values) {
    const that = this;
    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      /**
       * @todo I'd like to just use update with upsert:true, but I'm
       * note sure how the query will work if id == null. Seemed to
       * have some problems before with passing null ids.
       */
      if (id === null) {
        db.insert(values, function(error, result) {
          if (error) return reject(error);
          return resolve(result._id);
        });
      } else {
        db.update({ _id: id }, { $set: values }, { upsert: true }, function(
          error,
          result
        ) {
          if (error) return reject(error);
          return resolve(result);
        });
      }
    });
  }

  /**
   * @method delete
   * @description Delete document
   * @param {String} collection Collection's name
   * @param {ObjectId} id Document's id
   * @return {Promise}
   */
  delete(collection, id) {
    const that = this;
    return new Promise(function(resolve, reject) {
      if (id === null) resolve(0);

      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      db.remove({ _id: id }, function(error, numRemoved) {
        if (error) return reject(error);
        return resolve(numRemoved);
      });
    });
  }

  /**
   * @method deleteOne
   * @description Delete one document by query
   * @param {String} collection Collection's name
   * @param {Object} query Query
   * @return {Promise}
   */
  deleteOne(collection, query) {
    const that = this;
    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      db.remove(query, function(error, numRemoved) {
        if (error) return reject(error);
        return resolve(numRemoved);
      });
    });
  }

  /**
   * @method deleteMany
   * @description Delete many documents by query
   * @param {String} collection Collection's name
   * @param {Object} query Query
   * @return {Promise}
   */
  deleteMany(collection, query) {
    const that = this;
    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      db.remove(query, { multi: true }, function(error, numRemoved) {
        if (error) return reject(error);
        return resolve(numRemoved);
      });
    });
  }

  /**
   * @method findOne
   * @description Find one document
   * @param {String} collection Collection's name
   * @param {Object} query Query
   * @return {Promise}
   */
  findOne(collection, query) {
    const that = this;
    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      db.findOne(query, function(error, result) {
        if (error) return reject(error);
        return resolve(result);
      });
    });
  }

  /**
   * @method findOneAndUpdate
   * @description Find one document and update it
   * @param {String} collection Collection's name
   * @param {Object} query Query
   * @param {Object} values
   * @param {Object} options
   * @return {Promise}
   */
  findOneAndUpdate(collection, query, values, options = {}) {
    const that = this;

    // Since this is 'findOne...' we'll only allow user to update
    // one document at a time
    options.multi = false;

    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );

      that.findOne(collection, query).then(function(data) {
        if (!data) {
          if (options.upsert) {
            return db.insert(values, function(error, result) {
              if (error) return reject(error);
              return resolve(result);
            });
          } else {
            return resolve(null);
          }
        } else {
          return db.update(query, options.manual ? values : { $set: values }, function(error, result) {
            if (error) return reject(error);

            // Fixes issue #55. Remove when NeDB is updated to v1.8+
            db.findOne({ _id: data._id }, function(error, doc) {
              if (error) return reject(error);
              resolve(doc);
            });
          });
        }
      });
    });
  }

  /**
   * @method  findOneAndDelete
   * @description Find one document and delete it
   * @param {String} collection Collection's name
   * @param {Object} query Query
   * @param {Object} options
   * @return {Promise}
   */
  findOneAndDelete(collection, query, options = {}) {
    const that = this;

    // Since this is 'findOne...' we'll only allow user to update
    // one document at a time
    options.multi = false;

    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      db.remove(query, options, function(error, numRemoved) {
        if (error) return reject(error);
        return resolve(numRemoved);
      });
    });
  }

  /**
   * @method find
   * @description Find documents
   * @param {String} collection Collection's name
   * @param {Object} query Query
   * @param {Object} options
   * @return {Promise}
   */
  find(collection, query, options) {
    const that = this;
    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      let cursor = db.find(query);

      if (
        options.sort &&
        (_.isArray(options.sort) || _.isString(options.sort))
      ) {
        const sortOptions = {};
        if (!_.isArray(options.sort)) {
          options.sort = [options.sort];
        }

        options.sort.forEach(function(s) {
          if (!_.isString(s)) return;

          let sortOrder = 1;
          if (s[0] === '-') {
            sortOrder = -1;
            s = s.substring(1);
          }
          sortOptions[s] = sortOrder;
        });

        cursor = cursor.sort(sortOptions);
      }
      if (typeof options.skip === 'number') {
        cursor = cursor.skip(options.skip);
      }
      if (typeof options.limit === 'number') {
        cursor = cursor.limit(options.limit);
      }
      cursor.exec(function(error, result) {
        if (error) return reject(error);
        return resolve(result);
      });
    });
  }

  /**
   * @method count
   * @description Get count of collection by query
   * @param {String} collection Collection's name
   * @param {Object} query Query
   * @return {Promise}
   */
  count(collection, query) {
    const that = this;
    return new Promise(function(resolve, reject) {
      const db = getCollection(
        collection,
        that._collections,
        that._path,
        that._options
      );
      db.count(query, function(error, count) {
        if (error) return reject(error);
        return resolve(count);
      });
    });
  }

  /**
   * @method  createIndex
   * @description Create index for a specific field.
   * @param {String} collection Collection's name
   * @param {String} field Field name
   * @param {Object} options Options
   */
  createIndex(collection, field, options) {
    const db = getCollection(
      collection,
      this._collections,
      this._path,
      this._options
    );
    db.ensureIndex({
      fieldName: field,
      unique: options.unique,
      sparse: options.sparse
    });
  }

  /**
   * @method connect
   * @description  Connect to database
   * @param {String} url
   * @param {Object} options
   * @return {Promise}
   */
  static connect(url, options) {
    // Could be directory path or 'memory'
    const dbLocation = urlToPath(url);

    return new Promise(function(resolve, reject) {
      const collections = {};
      resolve(new NeDbClient(dbLocation, collections, options));
    });
  }

  /**
   * @method close
   * @description Close current connection
   */
  close() {
    // Nothing to do for NeDB
  }

  /**
   * @method clearCollection
   * @description Drops the specificed collection.
   * @param {String} collection
   * @return {Promise}
   */
  clearCollection(collection) {
    return this.deleteMany(collection, {});
  }

  /**
   * @method dropDatabase
   * @description  Drops the current database.
   * @return {Promise}
   */
  dropDatabase() {
    const that = this;

    const clearPromises = [];
    _.keys(this._collections).forEach(function(key) {
      const p = new Promise(function(resolve, reject) {
        const dbLocation = getCollectionPath(that._path, key);

        if (dbLocation === 'memory') {
          // Only exists in memory, so just delete the 'Datastore'
          delete that._collections[key];
          resolve();
        } else {
          // Delete the file, but only if it exists
          fs.stat(dbLocation, function(err, stat) {
            if (err === null) {
              fs.unlink(dbLocation, function(err) {
                if (err) reject(err);
                delete that._collections[key];
                resolve();
              });
            } else {
              resolve();
            }
          });
        }
      });
      clearPromises.push(p);
    });

    return Promise.all(clearPromises);
  }

  /**
   * @method toCanonicalId
   * @description Convert ids to canonical form.
   * @param {*} id the id to return as a string.
   * @return {*|string|String}
   */
  toCanonicalId(id) {
    return id;
  }

  /**
   * @method isNativeId
   * @description checks if a given valie is a native id.
   * @param {Any} value
   * @return {boolean}
   */
  isNativeId(value) {
    return String(value).match(/^[a-zA-Z0-9-]*$/) !== null;
  }

  /**
   * @method nativeIdType
   * @description returns the type used as a native id
   * @return {String} MongoDB String
   */
  nativeIdType() {
    return String;
  }

  /**
   * @method driver
   * @description returns the NEDB collections.
   * @return {Array} NEDB collections
   */
  driver() {
    return this._collections;
  }
}

module.exports = NeDbClient;
