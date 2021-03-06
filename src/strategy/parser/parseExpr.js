
//缓存求值函数，以便多次利用
var evaluatorPool = require('./evaluatorPool')

var rregexp = /(^|[^/])\/(?!\/)(\[.+?]|\\.|[^/\\\r\n])+\/[gimyu]{0,5}(?=\s*($|[\r\n,.;})]))/g
var rstring = /(["'])(\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/g
var rfill = /\?\?\d+/g
var brackets = /\(([^)]*)\)/

var rshortCircuit = /\|\|/g
var rpipeline = /\|(?=\w)/
var ruselessSp = /\s*(\.|\|)\s*/g

var rAt = /(^|[^\w\u00c0-\uFFFF_])(@|##)(?=[$\w])/g
var rhandleName = /^__vmodel__\.[$\w\.]+$/i

var robjectProperty = /\.[\w\.\$]+/g
var rvar = /\b[$a-zA-Z_][$a-zA-Z0-9_]*\b/g

function collectLocal(str, ret) {
    str.replace(/__vmodel__/, ' ').
            replace(robjectProperty, ' ').
            replace(rvar, function (el) {
                if (el !== '$event' && !avalon.keyMap[el]) {
                    ret[el] = 1
                }
            })
}

function extLocal(ret) {
    var arr = []
    for (var i in ret) {
        arr.push('var ' + i + ' = __local__[' + avalon.quote(i) + ']')
    }
    return arr
}

function parseExpr(str, category) {
    var binding = {}
    category = category || 'other'
    if (typeof str === 'object') {
        category = str.type
        binding = str
        str = binding.expr
    }

    var cacheID = str
    var cacheStr = evaluatorPool.get(category + ':' + cacheID)
    if (cacheStr) {
        return cacheStr
    }

    var number = 1
    //相同的表达式生成相同的函数
    var maps = {}
    function dig(a) {
        var key = '??' + number++
        maps[key] = a
        return key
    }
    function fill(a) {
        return maps[a]
    }
    var input = str.replace(rregexp, dig).//移除所有正则
            replace(rstring, dig).//移除所有字符串
            replace(rshortCircuit, dig).//移除所有短路或
            replace(ruselessSp, '$1').//移除. |两端空白
            split(rpipeline) //使用管道符分离所有过滤器及表达式的正体
    //还原body
    var _body = input.shift().replace(rAt, '$1__vmodel__.')
    var local = {}
    var body = _body.replace(rfill, fill).trim()

    /* istanbul ignore else  */

    if (category === 'js') {
        return evaluatorPool.put(category + ':' + cacheID, body)
    }
    //处理表达式的过滤器部分
    var filters = input.map(function (str) {
        str = str.replace(rAt, '$1__vmodel__.')
        if (category === 'on') {
            collectLocal(str.replace(/^\w+/, ''), local)
        }
        var bracketArgs = '(__value__'
        str = str.replace(brackets, function (a, b) {
            if (/\S/.test(b)) {
                bracketArgs += ',' + b.replace(rfill, fill) //还原字符串,正则,短路运算符
            }
            return ''
        })
        return str.replace(/^(\w+)/, '__value__ =  avalon.__format__("$1")') +
                bracketArgs + ')'
    })
    var ret = []
    if (category === 'on') {
        if (rhandleName.test(body)) {
            body = body + '($event)'
        }
        collectLocal(_body, local)
        filters = filters.map(function (el) {
            return el.replace(/__value__/g, '$event')
        })
        if (filters.length) {
            filters.push('if($event.$return){\n\treturn;\n}')
        }
        /* istanbul ignore if  */
        if (!avalon.modern) {
            body = body.replace(/__vmodel__\.([^(]+)\(([^)]*)\)/, function (a, b, c) {
                return '__vmodel__.' + b + ".call(__vmodel__" + (/\S/.test(c) ? ',' + c : "") + ")"
            })
        }

        ret = ['function ($event, __local__){',
            'try{',
            extLocal(local).join('\n'),
            '\tvar __vmodel__ = this;',
            '\t' + body,
            '}catch(e){',
            quoteError(str, category),
            '}',
            '}']
        filters.unshift(2, 0)
    } else if (category === 'duplex') {

        //给vm同步某个属性
        var setterBody = [
            'function (__vmodel__,__value__){',
            'try{',
            '\t' + body + ' = __value__',
            '}catch(e){',
            quoteError(str, category).replace('parse', 'set'),
            '}',
            '}']
        evaluatorPool.put('duplex:set:' + cacheID, setterBody.join('\n'))
        //对某个值进行格式化

        var getterBody = [
            'function (__vmodel__){',
            'try{',
            'var __value__ = ' + body + '\n',
            filters.join('\n'),
            'return __value__\n',
            '}catch(e){',
            quoteError(str, category).replace('parse', 'get'),
            '}',
            '}'].join('\n')
        evaluatorPool.put('duplex:get:' + cacheID, getterBody)

        return  getterBody
    } else {
        binding.body = body
        ret = [
            'function (){',
            'try{',
            'var __value__ = ' + body,
            (category === 'text' ?
                    'return avalon.parsers.string(__value__)' :
                    'return __value__'),
            '}catch(e){',
            quoteError(str, category),
            '\treturn ""',
            '}',
            '}'
        ]
        filters.unshift(3, 0)
    }
    ret.splice.apply(ret, filters)
    cacheStr = ret.join('\n')
    evaluatorPool.put(category + ':' + cacheID, cacheStr)
    return cacheStr

}

function quoteError(str, type) {
    return '\tavalon.warn(e, ' +
            avalon.quote('parse ' + type + ' binding【 ' + str + ' 】fail')
            + ')'
}
module.exports = avalon.parseExpr = parseExpr

