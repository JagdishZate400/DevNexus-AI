// Repository injection is explicit; failures never select another store.
function isEmailConflict(error) {
  return error && error.code === '23505' &&
    ['users_email_unique', 'users_email_lower_unique'].includes(error.constraint)
}

async function userQuery(req, method, ...args) {
  try {
    const repository = req.app.locals.userRepository || require('../db/users')
    return await repository[method](...args)
  } catch (error) {
    if (method === 'createUser' && isEmailConflict(error)) throw error
    const failure = new Error('User database operation failed')
    failure.status = 503
    failure.code = 'database_unavailable'
    throw failure
  }
}

module.exports = { userQuery, isEmailConflict }
