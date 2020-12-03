const esprima = require('esprima')

function operatorToSMT (op) {
  const map = {
    '&&': 'and',
    '||': 'or',
    '==': '=',
    '===': '=',
    '!': 'not',
    '%': 'rem' // reminder
  }
  return Object.keys(map).includes(op) ? map[op] : op
}

function toSMT_old (js) {
  const p = esprima.parseScript(js).body[0]

  function proc (exp) {
    console.log('toSMT:', exp)

    let lr = {
      'left': null,
      'right': null
    }
    Object.keys(lr).forEach(k => {
      if (exp[k].type === 'Identifier') {
        lr[k] = exp[k].name
      } else if (exp[k].type === 'Literal') {
        lr[k] = exp[k].value + ''
      } else {
        lr[k] = proc(exp[k])
      }
    })
    return '(' + operatorToSMT(exp.operator) + ' ' + lr.left + ' ' + lr.right + ')'
  }

  return proc(p.expression)
}

function toSMT (js) {
  const p = esprima.parseScript(js).body[0]
  const keys = ['argument', 'left', 'right']

  function proc (exp) {
    console.log('toSMT:', exp)
    // Convert a != b to !(a == b)
    switch (exp.type) {
      case 'CallExpression':
        let res = ''
        exp.arguments.forEach(e => { res += proc(e) + ' ' })
        return '(' + exp.callee.name + ' ' + res + ')'
      case 'UnaryExpression':
        return '(' + operatorToSMT(exp.operator) + ' ' + proc(exp.argument) + ')'
      case 'BinaryExpression':
        if ((exp.operator === '!=') || (exp.operator === '!==')) {
          exp['operator'] = '=='
          exp = {
            'type': 'UnaryExpression',
            'operator': '!',
            'argument': exp
          }
          return proc(exp)
        } else {
          return '(' + operatorToSMT(exp.operator) + ' ' + proc(exp.left) + ' ' + proc(exp.right) + ')'
        }
      case 'MemberExpression':
        return '(select ' + proc(exp.object) + ' ' + proc(exp.property) + ')'
      case 'ConditionalExpression':
        return '(ite ' + proc(exp.test) + ' ' + proc(exp.consequent) + ' ' + proc(exp.alternate) + ')'
      case 'Identifier':
        return exp.name
      case 'Literal':
        return exp.value
    }
  }

  return proc(p.expression)
}

module.exports = function (models, activeModel) {
  console.log(`Mr. Compiler: Oh, models again! Active model is ${activeModel} of ${models.length}`)
  const model = models[activeModel]
  console.log(model)

  let code = ''

  const dataTypes = {
    'float': 'Real',
    'integer': 'Int',
    'boolean': 'Bool'
  }

  // Iterate over all blocks of the model
  model.blocks.forEach(block => {
    const dataType = Object.keys(dataTypes).includes(block.dataType) ? dataTypes[block.dataType] : 'Int'
    if ((block.typeCode === 1) && block.name.length && block.value.length) {
      // Expression
      code += `(define-fun ${block.name} () ${dataType} ${toSMT(block.value)})\n`
    } else if ((block.typeCode === 2) && block.name.length) {
      // Data block
      if (block.value.length) {
        const value = (dataType === 'Real') && !block.value.includes('.') ? block.value + '.0' : block.value
        code += `(define-fun ${block.name} () ${dataType} ${value})\n`
      } else {
        code += `(declare-const ${block.name} ${dataType})\n`
      }
    } else if ((block.typeCode === 3) && (block.value) && (block.value.length)) {
      // Accumulator
      code += `(define-fun ${block.name}__0 () ${dataType} ${toSMT(block.initialValue + '')})\n`
      const s = model.modelParams.steps
      // Add loop
      for (let i = 0; i < s; i++) {
        const value = block.name + '__' + i + ' + ' + block.value
        // code += `(define-fun ${block.name + ((i < (s - 1)) ? '__' + (i + 1) + '' : '')} () ${dataType} ${toSMT(value)})\n`
        code += `(define-fun ${block.name}__${i + 1} () ${dataType} ${toSMT(value)})\n`
      }
      code += `(declare-const ${block.name} ${dataType})\n`
      code += `(assert ${toSMT(block.name + ' == ' + block.name + '__' + s)})\n`
      // Add min/max conditions
      if (block.min && block.min.length) {
        code += `(assert ${toSMT(block.name + ' >= ' + block.min)})\n`
      }
      if (block.max && block.max.length) {
        code += `(assert ${toSMT(block.name + ' <= ' + block.max)})\n`
      }
    } else if ((block.typeCode === 5) && (block.value) && (block.value.length)) {
      // Condition block
      code += `(assert ${toSMT(block.value)})\n`
    } else if ((block.typeCode === 7) && block.name.length) {
      // Function block
      const fargs = block.x.split(',').map(a => a.trim()).filter(a => a.length).map(a => '(' + a + ')').join(' ')
      if (block.y.length) {
        code += `(define-fun ${block.name} (${fargs}) ${dataType} ${toSMT(block.y)})\n`
      } else {
        code += `(declare-fun ${block.name} (${fargs}) ${dataType})\n`
      }
    } else if ((block.typeCode === 8) && (block.value) && (block.value.length)) {
      // Optimization block
      code += `(${block.optimizationType} ${toSMT(block.value)})\n`
    }
  })

  code += '(check-sat)\n(get-model)\n(get-objectives)\n(echo "---")\n(exit)'

  return code
}
