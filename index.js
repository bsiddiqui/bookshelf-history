'use strict'

let extend = require('xtend')

/**
 * Base model for all models that need backup and restoration
 * @param {Object} bookshelf An instantiated Bookshelf.js instance
 * @param {Object} HistoryModel A valid Bookshelf.js model representing where all
 * states will be stored
 * @return {Object} A new base model that can be extended
 */
module.exports = (bookshelf, options) => {
  let base = bookshelf.Model
  let defaults = extend({
    fields: {
      sequence: 'sequence',
      resource_id: 'resource_id',
      resource_type: 'resource_type',
      data: 'data',
      patch: 'patch',
      operation: 'operation'
    },
    model: base.extend({ tableName: 'history' }),
    autoHistory: [ 'created', 'updated' ]
  }, options)

  bookshelf.Model = bookshelf.Model.extend({
    /**
     * Override the default initializer to allow history to auto backup
     */
    initialize () {
      // Do not override the previous constructor
      base.prototype.initialize.apply(this, arguments)

      // Do nothing if the model doesn't have history enabled
      if (this.history) {
        this.historyOptions = extend(defaults, this.history)
      } else {
        return
      }

      // Register every autoHistory hook
      if (this.historyOptions.autoHistory) {
        this.historyOptions.autoHistory.forEach(hook => {
          this.on(hook, (model, attrs, options) => {
            if (options.history === false) {
              return
            } else {
              return model.constructor.history(model, Boolean(options.patch), hook, options.transacting)
            }
          })
        })
      }
    }
  }, {
    /**
     * Manually backups a resource
     * @param {Any} resourceId The ID from the resource that will be backed up
     * @param {Object} [options]
     * @param {Object} [options.transacting] A valid transaction object
     * @return {Object} An instantiated History model containing the created backup
     */
    backup (resourceId, options) {
      let execute = transacting => {
        return this.forge({ id: resourceId })
        .fetch({ transacting })
        .then(model => this.history(model, false, 'manual', transacting))
      }

      if (options && options.transacting) {
        return execute(options.transacting)
      } else {
        return bookshelf.transaction(transacting => execute(transacting))
      }
    },

    /**
     * Reverts a resource to a previous state
     * @param {Any} resourceId The ID from the resource that will be backed up
     * @param {Number} [sequence] The state sequence to be used when restoring,
     * if none is provided the latest state for that resource will be used
     * @param {Object} [options]
     * @param {Object} [options.transacting] A valid transaction object
     * @return {Number} The number of rows affected by the restoration
     */
    revert (resourceId, sequence, options) {
      if (typeof sequence !== 'number') {
        options = sequence
        sequence = null
      }

      let execute = (model, transacting) => {
        let fields = model.historyOptions.fields

        let query = {}
        query[fields.resource_type] = this.prototype.tableName
        query[fields.resource_id] = resourceId

        if (sequence) {
          query[fields.sequence] = sequence
        }

        return model.historyOptions.model.query(qb => {
          qb.where(query)

          // Select latest sequence if none was provided
          if (!sequence) {
            qb.orderBy(fields.sequence, 'desc')
          }
        })
        .fetch({ transacting })
        .then(history => {
          let data = history.get('data')
          let idAttribute = model.idAttribute
          let where = {}
          where[idAttribute] = model.id

          // JSON/B fields are already deserialized
          if (typeof data === 'string') {
            data = JSON.parse(data)
          }

          // Remove the primary key
          delete data[model.idAttribute]

          return bookshelf.knex(model.tableName)
          .transacting(transacting)
          .update(data)
          .where(where)
        })
      }

      let forge = {}
      forge[this.prototype.idAttribute] = resourceId

      if (options && options.transacting) {
        return this.forge(forge)
        .fetch({ transacting: options.transacting })
        .then(model => execute(model, options.transacting))
      } else {
        return bookshelf.transaction(transacting => {
          return this.forge(forge)
          .fetch({ transacting })
          .then(model => execute(model, transacting))
        })
      }
    },

    /**
     * Helper function to aid on backup creating
     * @param {Object} model An instantiated model
     * @param {Boolean} patch If that operation was executed with a patch
     * @param {String} operation The name of the operation performed previously
     * from the backup
     * @param {Object} [transacting] A valid transaction object
     * @return {Number} The number of rows affected by the restoration
     */
    history (model, patch, operation, transacting) {
      let fields = model.historyOptions.fields
      let execute = transacting => {
        let forge = {}
        forge[fields.resource_id] = model.id
        forge[fields.resource_type] = model.tableName

        return model.historyOptions.model.forge(forge)
        .fetch({ transacting, require: false })
        .then(row => row ? Number(row.get(fields.sequence)) + 1 : 1)
        .then(sequence => {
          let data = {}
          data[fields.sequence] = sequence
          data[fields.resource_id] = model.id
          data[fields.resource_type] = model.tableName
          data[fields.data] = JSON.stringify(model)
          data[fields.patch] = Boolean(patch)
          data[fields.operation] = operation

          return model.historyOptions.model.forge(data)
          .save(null, { transacting })
        })
      }

      if (transacting) {
        return execute(transacting)
      } else {
        return bookshelf.transaction(transacting => execute(transacting))
      }
    },

    /**
     * Returns the model being used to save the history for this model or false
     * if history is disabled
     * @return {Object|Boolean} Return the Bookshelf model being used by history
     * for this model or false if the model have history disabled
     */
    historyModel () {
      if (this.prototype.history && this.prototype.history.model) {
        return this.prototype.history.model
      } else if (this.prototype.history) {
        return defaults.model
      } else {
        return false
      }
    }
  })
}
