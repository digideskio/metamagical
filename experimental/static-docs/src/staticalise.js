//---------------------------------------------------------------------
//
// This source file is part of the Meta:Magical project.
//
// See LICENCE for licence information.
// See CONTRIBUTORS for the list of contributors to the project.
//
//---------------------------------------------------------------------

// --[ Dependencies ]--------------------------------------------------
const uuid   = require('node-uuid').v4;
const marked = require('marked');

const hasOwnProperty = Object.prototype.hasOwnProperty;
const prototypeOf    = Object.getPrototypeOf;


// --[ Helpers ]-------------------------------------------------------
const isObject = (value) => Object(value) === value;


const isDocumented = (meta) => meta.get(meta.fields.documentation)
                                   .map(_ => true)
                                   .getOrElse(false);


const summary = (text) => {
  const maybeParagraph = marked.lexer(text)[0];
  if (maybeParagraph && maybeParagraph.type === 'paragraph') {
    return maybeParagraph.text;
  } else {
    return '';
  }
};


const compact = (object) => {
  let result = Object.create(null);

  Object.keys(object).forEach(key => {
    const value = object[key];
    if (!value.isNothing) {
      result[key] = value.get();
    }
  });

  return result;
};


const serialiseMeta = (meta) => {
  const _ = meta.fields;

  return compact({
    copyright     : meta.get(_.copyright),
    authors       : meta.get(_.authors),
    maintainers   : meta.get(_.maintainers),
    licence       : meta.get(_.licence),
    since         : meta.get(_.since),
    deprecated    : meta.get(_.deprecated),
    repository    : meta.get(_.repository),
    stability     : meta.get(_.stability),
    homepage      : meta.get(_.homepage),
    category      : meta.get(_.category),
    tags          : meta.get(_.tags),
    npmPackage    : meta.get(_.npmPackage),
    module        : meta.get(_.module),
    isModule      : meta.get(_.isModule),
    isRequired    : meta.get(_.isRequired),
    name          : meta.get(_.name),
    location      : meta.get(_.location),
    source        : meta.get(_.source),
    documentation : meta.get(_.documentation),
    summary       : meta.get(_.documentation).map(summary),
    signature     : meta.get(_.signature),
    type          : meta.get(_.type),
    throws        : meta.get(_.throws),
    parameters    : meta.get(_.parameters),
    returns       : meta.get(_.returns),
    complexity    : meta.get(_.complexity),
    platforms     : meta.get(_.platforms),
    portable      : meta.get(_.portable)
  });
};


const startsWith = (substring, text) => text.indexOf(substring) === 0;


const propertySignature = (name, signature) =>
  startsWith(`${name}(`, signature)  ?  signature
: /* otherwise */                       `${name}: ${signature}`;


const propertyRepresentation = (meta, { name, value, kind }) =>
  kind === 'getter'           ?  `get ${name}`
: kind === 'setter'           ?  `set ${name}`
: typeof value === 'function' ?  meta.for(value)
                                     .get(meta.fields.signature).map(sig => propertySignature(name, sig))
                                     .getOrElse(`${name}()`)
: /* otherwise */                name;

const findDefinition = (object, property) =>
  hasOwnProperty.call(object, property) ?  object
: prototypeOf(object) != null           ?  findDefinition(prototypeOf(object), property)
: /* otherwise */                          null;


// --[ Implementation ]------------------------------------------------
const makeStatic = (meta, root, name, options = {}) => {
  let references = new Map(options.references ? options.references.entries() : []);
  let skip       = options.skip || new Set();
  let skipProps  = options.skipProperties || new Set();
  let result     = new Map();


  const shouldSkip = (object) => !isObject(object)
                              || skip.has(object)
                              || (options.skipUndocumented && !isDocumented(meta.for(object)))
                              || references.has(object);

  const shouldSkipProperty = (object, property) => 
    skip.has(findDefinition(object, property));

  const allowsPopping = (path) => (path[0] === '(unknown module)' && path.length > 1)
                               || path.length > 0;


  const computeIndexPath = (object, path) => meta.for(object)
                                                 .get(meta.fields.module)
                                                 .map(modulePath => modulePath.split('/'))
                                                 .getOrElse(['(unknown module)', ...path]);


  const isModule = (object) => meta.for(object)
                                   .get(meta.fields.isModule)
                                   .getOrElse(false);


  const truePath = (object, name, path) => {
    let parentPath = computeIndexPath(object, path);
    if (isModule(object) && allowsPopping(parentPath)) {
      name = parentPath.pop();
    }

    return [...parentPath, name];
  };


  const serialise = (object, name, path) => {
    const id = uuid();
    references.set(object, id);
    return Object.assign({
      id,
      path: truePath(object, name, path)
    }, serialiseMeta(meta.for(object)));
  };

  const go = (object, name, path) => {
    if (shouldSkip(object))  return;

    const data = serialise(object, name, path);
    result.set(data.id, data);
    data.properties = meta.for(object).allProperties().map(group => {
      const members = group.members.filter(m => !shouldSkipProperty(object, m.name));

      members.forEach(p => go(p.value, p.name, [...path, name]));
      return {
        category : group.category,
        members  : members.map(member => ({
          name           : member.name,
          reference      : references.get(member.value),
          kind           : member.kind,
          representation : propertyRepresentation(meta, member),
          meta           : serialiseMeta(meta.for(member.value))
        }))
      };
    }).filter(group => group.members.length > 0);
  };

  go(root, name, []);
  return [...result.values()];
};


// --[ Exports ]-------------------------------------------------------
module.exports = {
  makeStatic
};
