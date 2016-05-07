//----------------------------------------------------------------------
//
// This source file is part of the Meta:Magical project.
//
// See LICENCE for licence information.
// See CONTRIBUTORS for the list of contributors to the project.
//
//----------------------------------------------------------------------

// -- DEPENDENCIES -----------------------------------------------------
require('babel-polyfill');
const { exec } = require('child_process');
const { Text, Sequence, Block, Options, Directive, Title } = require('./rst');
const { Just, Nothing } = require('folktale/data/maybe');
const generateJs = require('babel-generator').default;
const parseJs    = require('babylon').parse;
const t          = require('babel-types');


// -- ALIASES ----------------------------------------------------------
const keys           = Object.keys;
const ownProperties_ = Object.getOwnPropertyNames;
const getProperty    = Object.getOwnPropertyDescriptor;
const prototypeOf    = Object.getPrototypeOf;

// -- HELPERS ----------------------------------------------------------
function ownProperties(object) {
  const props = ownProperties_(object);

  if (typeof object === "function" || object === Function.prototype) {
    return props.filter(k => k !== "caller" && k !== "arguments");
  } else {
    return props;
  }
}

async function shell(originalCommand, args, options) {
  const argString = args.map(x => JSON.stringify(String(x))).join(' ');
  const command   = `${originalCommand} ${argString}`;

  return new Promise((resolve, reject) => {
    const child = exec(command, (error, stdout, stderr) => {
      if (error)  reject(error);
      else        resolve({ output: stdout, error: stderr });
    });
    if (options.input) {
      child.stdin.end(options.input, 'utf-8');
    }
  });
}

function isFunction(value) {
  return typeof value === 'function';
}

function compact(list) {
  return list.filter(x => x && !x.isNothing);
}

function entries(object) {
  return keys(object).map(key => [key, object[key]]);
}

function fromNullable(value) {
  return value == null? Nothing() : Just(value);
}

function flatten(lists) {
  return lists.reduce((l, r) => l.concat(r), []);
}

function compare(left, right) {
  return left < right ?  -1
  :      left > right ?   1
  :      /* else */       0;
}

function groupBy(array, groupingFn) {
  let result = new Map();

  array.forEach(value => {
    const key    = groupingFn(value);
    const values = result.get(key) || [];

    values.push(value);
    result.set(key, values);
  });

  return Array.from(result.entries());
}

function describeProperty(p, name) {
  return p.value && isFunction(p.value) ?   [`${name}()`,       'function',  p]
  :      p.get && p.set                 ?   [`get/set ${name}`, 'attribute', p]
  :      p.get                          ?   [`get ${name}`,     'attribute', p]
  :      p.set                          ?   [`set ${name}`,     'attribute', p]
  :      /* otherwise */                    [name,              'data',      p];
}

function groupedProperties(meta, object) {
  function category({ value }) {
    return isObject(value) ?  meta.forObject(value).get('category').getOrElse('(Uncategorised)')
    :      /* else */         '(Uncategorised)';
  }

  const ps = ownProperties(object)
               .map(key => [key, object[key]])
               .sort(([k1, _], [k2, __]) => compare(k1, k2))
               .map(([k, value]) => {
                 const [name, kind, property] = describeProperty(getProperty(object, k), k);
                 return { name, kind, property, value }
               });
  return groupBy(ps, category).map(([category, members]) => ({ category, members }))
                              .sort((a, b) => compare(a.category, b.category));
}

function compactObject(object) {
  let result = {};

  entries(object).forEach(([key, value]) => {
    value.chain(v => result[key] = v);
  });

  return result;
}

function isObject(value) {
  return Object(value) === value;
}

function link(title, doc) {
  return Directive(
    'rst-class', 'detail-link',
    null,
    Text(`:doc:${title}<${doc}>`)
  );
}

function name(meta) {
  return meta.get('signature')
             .orElse(_ => meta.get('name'))
             .getOrElse('(Anonymous Object)');
}

function renderDeprecation({ version, reason }) {
  return Directive('deprecated', version, null, Text(reason));
}

function renderType(type) {
  return Directive('code-block', 'haskell', null, Text(type));
}

function maybeMeta(meta) {
  return compactObject({
    'From':        meta.get('module'),
    'Defined in':  meta.get('belongsTo').map(o => name(meta.forObect(o))),
    'Copyright':   meta.get('copyright'),
    'Licence':     meta.get('licence'),
    'Repository':  meta.get('repository'),
    'Category':    meta.get('category'),
    'Since':       meta.get('since'),
    'Stability':   fromNullable(meta.getPropagated('stability')),
    'Portability': fromNullable(meta.getPropagated('portability')),
    'Platforms':   meta.get('platforms').map(x => x.join(', ')),
    'Maintainers': meta.get('maintainers').map(x => x.join(', ')),
    'Authors':     fromNullable(meta.getPropagated('authors')).map(x => x.join(', '))
  });
}

async function markdownToRST(markdown, headingLevel) {
  const { output } = await shell('pandoc', [
    '--from=markdown',
    '--to=rst',
    `--base-header-level=${Number(headingLevel) || 1}`
  ], { input: markdown });

  return output;
}

function inferSource(object) {
  return typeof object === "function" ?  Just(object.toString())
  :      /* otherwise */                 Nothing();
}

function inferSourceWithoutWrapper(f, babelOptions) {
  function getBody(node) {
    return Array.isArray(node)            ?  node
    :      node.type === 'BlockStatement' ?  node.body
    :      /* otherwise */                   (_ => { throw new Error("Invalid example.") });
  }

  return inferSource(f).chain(source => {
    let ast;
    try {
      ast = parseJs(`(${source})`, babelOptions || {}).program.body[0];
    } catch (e) {
      return Nothing();
    }
    if (!ast) {
      return Nothing();
    } else if (ast.type === 'ExpressionStatement' && ast.expression.type === 'FunctionExpression') {
      return Just(generateJs(t.program(getBody(ast.expression.body))).code);
    } else {
      return Nothing();
    }
  });
}

function source(meta) {
  return meta.get('source').orElse(_ => inferSource(meta.object())).map(code => Block([
    Title('Source', 2),
    Directive('code-block', 'javascript', null, Text(code))
  ])).getOrElse(null);
}

function merge(objects) {
  return Object.assign({}, ...objects);
}

function toParameters(prefix, object) {
  let result = {};

  keys(object).forEach(key => {
    result[`${prefix} ${key}`] = object[key];
  });

  return object;
}

async function renderMember(meta, { name, kind, property, value }) {
  const doc = meta.get('documentation').getOrElse(null);

  return Block([
    Text('.. rst-class:: hidden-heading'),
    Text(''),
    Title(name, 4),
    Directive(
      `js:${kind}`,
      name,
      null,
      Block(compact([
        kind === 'function' ? Options(merge(compact([
                                meta.get('throws').map(v => toParameters('throws', v)).getOrElse(null),
                                meta.get('parameters').map(v => toParameters('param', v)).getOrElse(null),
                                meta.get('returns').map(v => ({ 'returns': v })).getOrElse(null)
                              ])))
        : /* else */          null,
        meta.get('type').map(renderType).getOrElse(null)
      ]))
    ),
    Text(doc ? (await markdownToRST(doc, 5)) : '')
  ]);
}

function typeOf(value) {
  return typeof value === 'string'  ?  'String'
  :      typeof value === 'number'  ?  'Number'
  :      typeof value === 'boolean' ?  'Boolean'
  :      value === null             ?  'Null'
  :      value === undefined        ?  'Undefined'
  :      /* otherwise */               'Unknown';
}

function intoObject(value) {
  return isObject(value) ?  value
  :      /* otherwise */    {
                              [Symbol.for('@@meta:magical')]: {
                                type: typeOf(value),
                              }
                            };
}

async function properties(meta, prefix) {
  const props = groupedProperties(meta, meta.object());

  if (props.length === 0) {
    return await inheritedProperties(meta);
  } else {
    return Block([
      Title(`${prefix || 'Properties in'} ${meta.get('name').getOrElse('(Anonymous)')}`, 2),
      Block(await Promise.all(props.map(async ({ category, members }) => Block([
        Title(category || 'Uncategorised', 3),
        Block(await Promise.all(members.map(m => renderMember(meta.forObject(intoObject(m.value)), m))))
      ])))),
      await inheritedProperties(meta)
    ]);
  }
}

async function inheritedProperties(meta) {
  const parent = prototypeOf(meta.object());

  if (parent == null) {
    return Block([]);
  } else {
    return await properties(meta.forObject(parent), 'Properties inherited from');
  }
}

function renderCode(code) {
  return Directive('code-block', 'javascript', null, Text(code));
}

function getProperFunction(example) {
  return typeof example === 'function' ?  example
  :      /* otherwise */                  example.call;
}

function examples(meta, babelOptions) {
  const xs     = groupBy(meta.get('examples').getOrElse([]), x => x.name);
  const unamed = flatten(xs.filter(([name, _]) => !name).map(([_, v]) => v));
  const named  = xs.filter(([name, _]) => name);

  if (xs.length === 0) {
    return null;
  } else {
    return Block([
      Title('Examples', 2),
      Block(compact(
        unamed.map(f => inferSourceWithoutWrapper(getProperFunction(f), babelOptions)
                          .map(renderCode)
                          .getOrElse(null))
      )),
      Block(compact(
        named.map(([category, examples]) => {
          const rendered = compact(examples.map(f => inferSourceWithoutWrapper(getProperFunction(f), babelOptions)
                                                       .map(renderCode)
                                                       .getOrElse(null)));

          if (rendered.length === 0) {
            return null;
          } else {
            return Block([
              Title(category, 3),
              Block(rendered)
            ]);
          }
        })
      ))
    ]);
  }
}

async function renderToSphinx(meta, babelOptions) {
  return Block(compact([
    Title(meta.get('name').getOrElse('(Anonymous)')),
    meta.get('deprecated').map(renderDeprecation).getOrElse(null),
    Options(maybeMeta(meta)),
    Title(name(meta), 1),
    Options(compactObject({
      'Complexity': meta.get('complexity'),
      'Throws': meta.get('throws').map(x => Options(x).render())
    })),
    Text(''),
    meta.get('type').map(renderType).getOrElse(null),
    Text(await markdownToRST(meta.get('documentation').getOrElse('(No documentation)')), 2),
    source(meta),
    await properties(meta),
    examples(meta, babelOptions)
  ]));
}


// -- IMPLEMENTATION ---------------------------------------------------
module.exports = function(meta, babelOptions) {

  async function generateOne(object) {
    const m = meta.forObject(object);
    return {
      name: m.get('name').getOrElse('(Anonymous)'),
      content: (await renderToSphinx(m, babelOptions)).render()
    };
  }


  // --- EXPORTS -------------------------------------------------------
  return { generateOne };
};
