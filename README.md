# bookshelf-history

**bookshelf-history** is a plugin for Bookshelf.js that lets you easily handle
row backup and restoration. Even automatic backup is supported.

### Usage

```javascript
// Just plug History in bookshelf
bookshelf.plugin(require('bookshelf-history'))

// Now create your model as usual setting the property history to true to allow
// custom methods to work properly and enable automatic backup
let User = bookshelf.Model.extend({ tableName: 'users', history: true })
```

### Methods

* `Model.backup(resourceId, [options])` perform a manual backup on a model that
has history enabled. `resourceId` must be the ID from the row to be backed up
and `options` is an optional object where you can pass a transaction object as
`options.transacting`.
* `Model.revert(resourceId, [sequence], [options])` restores a resource to a
specific back-up sequence. If no `sequence` is provided the resource will be
restored to the latest known sequence. `options` is an optional object where you
can pass a transaction object as `options.transacting`.
* `Model.historyModel()` returns the history model being used for query operations
in the Model or `false` if history is disabled.

### Default options

```javascript
let defaults = {
  fields: {
    sequence: 'sequence',
    resource_id: 'resource_id',
    resource_type: 'resource_type',
    changed: 'changed',
    data: 'data',
    patch: 'patch',
    operation: 'operation',
    getAuthorMetadata: null
  },
  model: bookshelf.Model.extend({ tableName: 'history' })
  autoHistory: [ 'created', 'updated' ],

}
```

These options can be globally overwritten when adding the plugin to bookshelf

```javascript
bookshelf.plugin(require('bookshelf-history'), {
  fields: {
    sequence: 'version',
    data: 'row_content'
  },
  model: bookshelf.Model.extend({ tableName: 'backups' })
})
```

Or also when creating each subsequent model

```javascript
let User = bookshelf.Model.extend({
  tableName: 'user',
  history: {
    autoHistory: false
  }
})
```

### Author Metadata

History now supports an `getAuthorMetadata(model)` option that will allow you to implement a function
to return the `id` and `source` of the author who requested the model mutation. The implementation is
up to you, but the most popular choice is to use the [continuation pattern](https://www.npmjs.com/package/cls-hooked).

```
const getNamespace = require('cls-hooked').getNamespace
const localStorage = getNamespace('app')
```

```
history: {
  getAuthorMetadata: () => {
    if (!localStorage) {
      return
    }

    return {
      id: localStorage.get('author_id'),
      source: localStorage.get('author_source')
    }
  }
}
```


### Migration

A migration example [can be found here](/test/migrations/20200228112321_create_history.js).
All fields are required with the exception of `created_at`. You can also specify
custom field names using the configuration as shown in the section above.

History also supports `JSON` and `JSONB` field types out of the box for the `data`
field when running with PostgreSQL. With other databases the `data` field gets
stringifyed with `JSON.stringify()` so make sure your `data` field is long
enough to store all data you need.

### Bypassing backups

If you want to perform an operation inside a History enabled model but don't
want to trigger an automatic backup you can make it two ways:

```javascript
// Disable automatic backups entirely for the model
let User = bookshelf.Model.extend({
  tableName: 'users',
  history: {
    autoHistory: false
  }
})

// Or disable for a single operation
User.forge({
  name: 'John',
  email: 'john@doe.com'
})
.save(null, { history: false })
```

### Testing

```
cd ./bookshelf-history
npm install
DATABASE_URL=postgres://postgres:postgres@localhost/history npm test
```
