'use strict'

const Lab = require('lab')
const lab = exports.lab = Lab.script()
const Code = require('code')
const expect = Code.expect
const knex = require('knex')(require('./knexfile').development)
const bookshelf = require('bookshelf')(knex)

bookshelf.plugin(require('../'))
const Test = bookshelf.Model.extend({ tableName: 'test', history: true })
const History = Test.historyModel()

lab.before(done => knex.migrate.latest().then(() => done(), done))

lab.experiment('general testing', () => {
  lab.test('should run with default arguments', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .then(model => model.set('name', 'Jonny').save())
      .then(model => History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll())
      .then(models => {
        expect(models).to.have.length(2)
        console.log(models.toJSON())
        expect(models.find({ operation: 'created', sequence: 1 })).to.exist()
        expect(JSON.parse(models.find({ operation: 'created', sequence: 1 }).get('data')).name).to.equal('John Doe')
        expect(models.find({ operation: 'updated', sequence: 2 })).to.exist()
        expect(JSON.parse(models.find({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('Jonny')
      })
      .then(done, done)
  })

  lab.test('should detect patch operation', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .then(model => model.save({ name: 'Jonny' }, { patch: true }))
      .then(model => History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll())
      .then(models => {
        expect(models).to.have.length(2)
        expect(models.findWhere({ operation: 'created', sequence: 1 })).to.exist()
        expect(JSON.parse(models.findWhere({ operation: 'created', sequence: 1 }).get('data')).name).to.equal('John Doe')
        expect(models.findWhere({ operation: 'updated', sequence: 2 })).to.exist()
        expect(models.findWhere({ operation: 'updated', sequence: 2 }).get('patch')).to.be.true()
        expect(JSON.parse(models.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('Jonny')
      })
      .then(done, done)
  })

  lab.test('should not hook when history is disabled', done => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: false })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .then(model => History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll())
      .then(models => {
        expect(Test.historyModel()).to.be.false()
        expect(models).to.have.length(0)
      })
      .then(done, done)
  })

  lab.test('should not backup when options.history is false', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .then(model => model.set('name', 'changed').save(null, { history: false }))
      .then(model => History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll())
      .then(models => {
        expect(models).to.have.length(1)
        expect(models.findWhere({ operation: 'created', sequence: 1 })).to.exist()
        expect(models.findWhere({ operation: 'updated' })).to.not.exist()
      })
      .then(done, done)
  })
})

lab.experiment('backup', () => {
  lab.test('should work', done => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .tap(model => Test.backup(model.id))
      .then(model => History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll())
      .then(models => {
        expect(models).to.have.length(1)
        expect(models.findWhere({ operation: 'manual', sequence: 1 })).to.exist()
      })
      .then(done, done)
  })

  lab.test('should accept running transactions', done => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    bookshelf.transaction(transacting => {
      return Test.forge({
        name: 'John Doe',
        email: 'johndoe@gmail.com'
      })
        .save(null, { transacting })
        .tap(model => Test.backup(model.id, { transacting }))
        .then(model => History.where({
          resource_type: model.tableName,
          resource_id: model.id
        }).fetchAll({ transacting }))
        .then(models => {
          expect(models).to.have.length(1)
          expect(models.findWhere({ operation: 'manual', sequence: 1 })).to.exist()
        })
    })
      .then(() => done(), done)
  })
})

lab.experiment('revert', () => {
  lab.test('should work', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .then(model => model.set('name', 'changed').save())
      .tap(model => Test.revert(model.id, 1))
      .then(model => Test.forge({ id: model.id }).fetch())
      .then(model => {
        return [
          History.where({
            resource_type: model.tableName,
            resource_id: model.id
          }).fetchAll(),
          Test.forge({ id: model.id }).fetch()
        ]
      })
      .spread((histories, test) => {
        expect(histories).to.have.length(2)
        expect(JSON.parse(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('changed')
        expect(test.get('name')).to.equal('John Doe')
      })
      .then(done, done)
  })

  lab.test('should accept running transactions', done => {
    bookshelf.transaction(transacting => {
      return Test.forge({
        name: 'John Doe',
        email: 'johndoe@gmail.com'
      })
        .save(null, { transacting })
        .then(model => model.set('name', 'changed').save(null, { transacting }))
        .tap(model => Test.revert(model.id, 1, { transacting }))
        .then(model => Test.forge({ id: model.id }).fetch({ transacting }))
        .then(model => {
          return [
            History.where({
              resource_type: model.tableName,
              resource_id: model.id
            }).fetchAll({ transacting }),
            Test.forge({ id: model.id }).fetch({ transacting })
          ]
        })
        .spread((histories, test) => {
          expect(histories).to.have.length(2)
          expect(JSON.parse(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('changed')
          expect(test.get('name')).to.equal('John Doe')
        })
    })
      .then(() => done(), done)
  })

  lab.test('should use latest sequence when none is provided', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .then(model => model.set('name', 'changed').save())
      .then(model => model.set('name', 'changed2').save(null, { history: false }))
      .tap(model => Test.revert(model.id))
      .then(model => Test.forge({ id: model.id }).fetch())
      .then(model => {
        return [
          History.where({
            resource_type: model.tableName,
            resource_id: model.id
          }).fetchAll(),
          Test.forge({ id: model.id }).fetch()
        ]
      })
      .spread((histories, test) => {
        expect(histories).to.have.length(2)
        expect(JSON.parse(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('changed')
        expect(test.get('name')).to.equal('changed')
      })
      .then(done, done)
  })

  lab.test('should also work with json datatypes on postgres', done => {
    const History = bookshelf.Model.extend({ tableName: 'history_json' })
    const Test = bookshelf.Model.extend({
      tableName: 'test',
      history: {
        model: History
      }
    })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .then(model => model.set('name', 'changed').save())
      .tap(model => Test.revert(model.id, 1))
      .then(model => Test.forge({ id: model.id }).fetch())
      .then(model => {
        return [
          History.where({
            resource_type: model.tableName,
            resource_id: model.id
          }).fetchAll(),
          Test.forge({ id: model.id }).fetch()
        ]
      })
      .spread((histories, test) => {
        expect(histories).to.have.length(2)
        expect(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data').name).to.equal('changed')
        expect(test.get('name')).to.equal('John Doe')
        expect(Test.historyModel() === History).to.be.true()
      })
      .then(done, done)
  })
})

lab.experiment('history', () => {
  lab.test('should work', done => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
      .save()
      .tap(model => Test.history(model, true, 'manual'))
      .then(model => History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll())
      .then(models => {
        expect(models).to.have.length(1)
        expect(models.at(0).get('patch')).to.be.true()
        expect(models.at(0).get('operation')).to.equal('manual')
        expect(JSON.parse(models.at(0).get('data')).name).to.equal('John Doe')
      })
      .then(done, done)
  })
})
