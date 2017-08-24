const fs = require('fs')
const {spawn} = require('child_process')
const EventEmitter = require('events')
const binding = require('./build/Release/fs_admin.node')

module.exports.testMode = false

switch (process.platform) {
  case 'darwin': {
    module.exports.clearAuthorizationCache = function () {
      binding.clearAuthorizationCache()
    }

    module.exports.createWriteStream = function (filePath) {
      let authopen

      // Prompt for credentials synchronously to avoid creating multiple simultaneous prompts.
      if (!binding.spawnAsAdmin('/bin/echo', [], module.exports.testMode, () => {})) {
        const result = new EventEmitter()
        result.write = result.end = function () {}
        process.nextTick(() => result.emit('error', new Error('Failed to obtain credentials')))
        return result
      }

      if (module.exports.testMode) {
        authopen = spawn('/bin/dd', ['of=' + filePath])
      } else {
        authopen = spawn('/usr/libexec/authopen', ['-extauth', '-w', '-c', filePath])
        authopen.stdin.write(binding.getAuthorizationForm())
      }

      const result = new EventEmitter()

      result.write = (chunk, encoding, callback) => {
        authopen.stdin.write(chunk, encoding, callback)
      }

      result.end = (callback) => {
        if (callback) result.on('finish', callback)
        authopen.stdin.end()
      }

      authopen.on('exit', (exitCode) => {
        if (exitCode !== 0) {
          result.emit('error', new Error('authopen exited with code ' + exitCode))
        }
        result.emit('finish')
      })

      return result
    }

    module.exports.symlink = function (target, filePath, callback) {
      binding.spawnAsAdmin(
        '/bin/ln',
        ['-s', target, filePath],
        module.exports.testMode,
        wrapCallback('ln', callback)
      )
    }

    module.exports.unlink = function (filePath, callback) {
      binding.spawnAsAdmin(
        '/bin/rm',
        ['-rf', filePath],
        module.exports.testMode,
        wrapCallback('rm', callback)
      )
    }

    module.exports.makeTree = function (directoryPath, callback) {
      binding.spawnAsAdmin(
        '/bin/mkdir',
        ['-p', directoryPath],
        module.exports.testMode,
        wrapCallback('mkdir', callback)
      )
    }

    module.exports.recursiveCopy = function (sourcePath, destinationPath, callback) {
      binding.spawnAsAdmin(
        '/bin/rm',
        ['-r', '-f', destinationPath],
        module.exports.testMode,
        wrapCallback('rm', (error) => {
          if (error) return callback(error)
          binding.spawnAsAdmin(
            '/bin/cp',
            ['-r', sourcePath, destinationPath],
            module.exports.testMode,
            wrapCallback('cp', callback)
          )
        })
      )
    }

    break
  }

  case 'win32': {
    module.exports.symlink = function (target, filePath, callback) {
      binding.spawnAsAdmin(
        'cmd',
        ['/c', 'mklink', '/j', filePath, target],
        module.exports.testMode,
        wrapCallback('mklink', callback)
      )
    }

    module.exports.unlink = function (filePath, callback) {
      fs.stat(filePath, (error, status) => {
        if (error) return callback(error)
        if (status.isDirectory()) {
          binding.spawnAsAdmin(
            'cmd',
            ['/c', 'rmdir', '/s', '/q', filePath],
            module.exports.testMode,
            wrapCallback('rmdir', callback)
          )
        } else {
          binding.spawnAsAdmin(
            'cmd',
            ['/c', 'del', '/f', '/q', filePath],
            module.exports.testMode,
            wrapCallback('del', callback)
          )
        }
      })
    }

    module.exports.makeTree = function (directoryPath, callback) {
      binding.spawnAsAdmin(
        'cmd',
        ['/c', 'mkdir', filePath],
        module.exports.testMode,
        wrapCallback('mkdir', callback)
      )
    }

    module.exports.recursiveCopy = function (sourcePath, destinationPath, callback) {
      binding.spawnAsAdmin(
        'cmd',
        ['/c', require.resolve('./src/copy-folder.cmd'), sourcePath, destinationPath],
        module.exports.testMode,
        wrapCallback('robocopy', callback)
      )
    }
  }
}

function wrapCallback (commandName, callback) {
  return (exitCode) => callback(
    exitCode === 0
      ? null
      : new Error(commandName + ' failed with exit status ' + exitCode)
  )
}
