'use strict'

const diff = require('json-diff').diff
const extend = require('xtend')

/**
 * Base model for all models that need backup and restoration
 * @param {Object} bookshelf An instantiated Bookshelf.js instance
 * @param {Object} HistoryModel A valid Bookshelf.js model representing where all
 * states will be stored
 * @return {Object} A new base model that can be extended
 */
module.exports = (bookshelf, options = {}) => {
  const base = bookshelf.Model
  const defaults = extend({
    fields: {
      sequence: 'sequence',
      resource_id: 'resource_id',
      resource_type: 'resource_type',
      author_id: 'author_id',
      author_type: 'author_type',
      data: 'data',
      changed: 'changed',
      patch: 'patch',
      operation: 'operation'
    },
    model: base.extend({ tableName: 'history' }),
    autoHistory: ['created', 'updated'],
    authorCallback: null
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

      const hookMap = {
        created: 'creating',
        updated: 'updating'
      }

      const invalid = this.historyOptions.autoHistory.filter((i) => {
        return !Object.keys(hookMap).includes(i)
      })

      if (invalid.length > 0) {
        throw new Error(`autoHistory contains invalid options [${invalid.join(',')}]!`)
      }

      // Register every autoHistory hook
      if (this.historyOptions.autoHistory) {
        this.historyOptions.autoHistory.forEach(hook => {
          if (Object.keys(hookMap).includes(hook)) {
            this.on(hook, (model, options = {}) => {
              if (options.history === false) {
              } else {
                return model.constructor.history(model, Boolean(options.patch), hook, this.historyOptions, options.transacting)
              }
            })

            this.on(hookMap[hook], (model, attrs, options = {}) => {
              // Previous attributes are not present in the post-action hook so let's save on the model here.
              model._bookshelfHistoryPreviousAttributes = model.previousAttributes()
            })
          } else {
            throw new Error(`Unhandled hook for Bookshelf-History ${hook}!`)
          }
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
      const execute = transacting => {
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

      const execute = (model, transacting) => {
        const fields = model.historyOptions.fields

        const query = {}
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
            const idAttribute = model.idAttribute
            const where = {}
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

      const forge = {}
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
     * @param {Object} historyOptions The history options of the model
     * @param {Object} [transacting] A valid transaction object
     */
    history (model, patch, operation, historyOptions, transacting) {
      const fields = model.historyOptions.fields
      const execute = transacting => {
        const forge = {}
        forge[fields.resource_id] = model.id
        forge[fields.resource_type] = model.tableName

        if (!transacting) {
          console.warn('No transaction detected at time of History write. In the future, Bookshelf-History will enforce a transaction.')
        }

        return model.historyOptions.model.forge(forge)
          .fetch({ transacting, require: false })
          .then(row => row ? Number(row.get(fields.sequence)) + 1 : 1)
          .then(sequence => {
            const data = {}
            data[fields.sequence] = sequence
            data[fields.resource_id] = model.id
            data[fields.resource_type] = model.tableName
            data[fields.data] = JSON.stringify(model.attributes)
            data[fields.patch] = Boolean(patch)
            data[fields.operation] = operation

            if (historyOptions.authorCallback && typeof historyOptions.authorCallback === 'function') {
              const metadata = historyOptions.authorCallback(model)
              if (metadata) {
                data[fields.author_id] = metadata.id
                data[fields.author_type] = metadata.source
              }
            }

            if (model._bookshelfHistoryPreviousAttributes) {
              const jsonDiff = diff(model._bookshelfHistoryPreviousAttributes, model.attributes)
              data[fields.changed] = JSON.stringify(jsonDiff)
              delete model._bookshelfHistoryPreviousAttributes
            }

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
