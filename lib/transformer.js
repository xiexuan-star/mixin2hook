import t from '@babel/types';
import parser from '@babel/parser';
import traverse from '@babel/traverse';
import transformer from '@babel/core';
import { upperCaseFirstChar } from './utils.js';

/**
 * @typedef {
 * {type:string}
 * |Record<'start'|'end',number>
 * |Record<'key'|'name'|'object'|'value'|'body',AstNode>
 * |Record<'params'|'properties',AstNode[]>
 * } AstNode
 */

export class Transformer {
  dataSet = new Set();
  propSet = new Set();
  injectSet = new Set();

  /**
   * @param {Collector} collector
   */
  constructor(collector) {
    this.collector = collector;
  }

  /**
   * @description 根据转换结果组装代码
   * @returns {string}
   */
  get code() {
    return [
      this.getVueDependencies(),
      this.depCode,
      this.mixinCode,
      this.propCode,
      this.dataCode,
      this.injectNode,
      this.computedCode,
      this.methodCode,
      this.provideNode
    ].reduce((res, code) => {
      return res + (code ? `${code}\n` : '');
    }, '');
  }

  getVueDependencies() {
    const { data, props, computed, injects, provides } = this.collector;
    let deps = [];
    data.length && deps.push('ref');
    props.length && deps.push('defineProps');
    computed.length && deps.push('computed');
    injects.length && deps.push('inject');
    provides.length && deps.push('provide');
    return `import { ${deps.join(',')} } from 'vue';`;
  }

  /**
   * @description 根据node从source中截取代码
   * @param {AstNode} node
   * @returns {string}
   */
  getNodeSource(node) {
    return this.collector.source.substring(node.start, node.end);
  }

  /**
   * @description 将key关联上下文并通过handler处理不同情况
   * @param {string} key
   * @param {Record<string,Function>} handler
   * @returns {boolean}
   */
  contextHandler(key, handler) {
    switch (true) {
      case this.dataSet.has(key): {
        handler.data?.();
        break;
      }
      case this.propSet.has(key): {
        handler.prop?.();
        break;
      }
      case this.injectSet.has(key): {
        handler.inject?.();
        break;
      }
      case Object.keys(handler).includes(key): {
        handler[key]();
        break;
      }
      default: {
        return false;
      }
    }
    return true;
  }

  /**
   * @description 执行代码转换
   */
  transform() {
    const { deps, data, props, mixins, methods, computed, injects, provides } = this.collector;

    this.dep(deps);
    this.data(data);
    this.prop(props);
    this.inject(injects);
    this.provide(provides);
    this.computed(computed);
    this.method(methods);
    this.mixin(mixins);
  }

  /**
   * @description 将函数体中的this替换为上下文中的ref或props
   */
  replaceThis(path) {
    const { node } = path;
    if (t.isThisExpression(node.object)) {
      const connected = this.contextHandler(node.property.name, {
        data() {
          path.replaceWith(t.memberExpression(t.identifier(node.property.name), t.identifier('value')));
        },
        prop() {
          path.replaceWith(t.memberExpression(t.identifier('props'), t.identifier(node.property.name)));
        },
        inject() {
          path.replaceWith(t.memberExpression(t.identifier(node.property.name), t.identifier('value')));
          path.node.object.leadingComments = [{
            type: "CommentBlock",
            value: ` TODO If inject value "${node.property.name}" is not a Ref ,you should remove .value `
          }];
        },
        $set() {
          path.replaceWith(t.memberExpression(t.identifier('Reflect'), t.identifier('set')));
        }
      });
      if (!connected) {
        node.object.leadingComments = [{
          type: 'CommentBlock',
          value: ` TODO Unable to find the reference of ${node.property.name} `
        }];
      }
    }
  }

  /**
   * @description 为函数参数设置any作为初始类型
   */
  initParamType(path) {
    const { node } = path;
    const { params } = node;
    if (Array.isArray(params)) {
      params.forEach(paramNode => {
        if (t.isIdentifier(paramNode)) {
          paramNode.name =
            params.length === 1 && t.isArrowFunctionExpression(node)
              // 兼容化的处理，在不使用typescript插件情况下插入any类型
              ? `(${paramNode.name}:any)`
              : `${paramNode.name}:any`;
        }
      });
    }
  }

  /**
   * @description 根据key和body节点生成函数体
   * @param {AstNode} keyNode
   * @param {AstNode} bodyNode
   * @returns {string}
   */
  fnInitial(keyNode, bodyNode) {
    return `function ${this.getNodeSource(keyNode)} (${bodyNode.params.map(p => {
      return `${this.getNodeSource(p)}`;
    })})
        ${this.getNodeSource(bodyNode.body)}
      `;
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  dep(nodeList) {
    if (!nodeList.length) return '';
    this.depCode = nodeList.reduce((res, node) => {
      return res + this.getNodeSource(node) + '\n';
    }, '');
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  prop(nodeList) {
    if (!nodeList.length) return ``;
    this.propCode = `
    const props = defineProps({
    ${nodeList.reduce((res, node) => {
      this.propSet.add(node.key.name);
      return res + this.getNodeSource(node) + ',\n';
    }, '')}})\n`;
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  data(nodeList) {
    this.dataCode = nodeList.reduce((res, node) => {
      if (t.isObjectProperty(node)) {
        const key = this.getNodeSource(node.key);
        this.dataSet.add(key);
        return res + `const ${key} = ref(${this.getNodeSource(node.value)}); \n`;
      }
      return res;
    }, '');
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  method(nodeList) {
    this.methodCode = nodeList.reduce((res, node) => {
      let methodSource = ``;
      if (t.isObjectMethod(node)) {
        methodSource = this.fnInitial(node.key, node);
      } else if (t.isObjectProperty(node)) {
        const { value } = node;
        if (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) {
          methodSource = this.fnInitial(node.key, node.value);
        }
      }
      if (!methodSource) return res;
      const bodyAst = parser.parse(methodSource);
      const initParamType = this.initParamType.bind(this);
      const replaceThis = this.replaceThis.bind(this);
      traverse.default(bodyAst, {
        MemberExpression: replaceThis,
        // 自动为函数入参添加any
        ArrowFunctionExpression: initParamType,
        ObjectMethod: initParamType,
        FunctionDeclaration: initParamType
      });
      const { code } = transformer.transformFromAst(bodyAst, {});
      return res + code + '\n\n';
    }, ``);
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  computed(nodeList) {
    this.computedCode = nodeList.reduce((res, node) => {
      if (t.isObjectMethod(node)) {
        const source = `const ${this.getNodeSource(node.key)} = computed((${node.params.map(p => {
          return this.getNodeSource(p);
        })})=>${this.getNodeSource(node.body)}
      )`;
        const bodyAst = parser.parse(source);
        traverse.default(bodyAst, { MemberExpression: this.replaceThis.bind(this) });
        const { code } = transformer.transformFromAst(bodyAst, {});
        return res + code;
      }
      return res;
    }, '');
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  inject(nodeList) {
    this.injectNode = nodeList.reduce((res, node) => {
      let code = '';

      if (t.isStringLiteral(node)) {
        code = `const ${node.value} = inject('${node.value}');\n`;
        this.injectSet.add(node.value);
      } else if (t.isObjectProperty(node)) {
        let from = `'${node.key.name}'`, defaultValue = '';

        if (t.isObjectExpression(node.value)) {
          node.value.properties.forEach(property => {
            if (property.key.name === 'from') {
              from = this.getNodeSource(property.value);
            } else if (property.key.name === 'default') {
              defaultValue = this.getNodeSource(property.value);
            }
          });
        } else if (t.isStringLiteral(node.value)) {
          from = this.getNodeSource(node.value);
        }
        code = `const ${node.key.name} = inject(${from}${defaultValue ? `,${defaultValue}` : ''}) \n`;
        this.injectSet.add(node.key.name);
      }
      return res + code;
    }, '');
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  provide(nodeList) {
    this.provideNode = nodeList.reduce((res, node) => {
      if (t.isStringLiteral(node.value)) {
        let provideValue = ``;
        const key = node.key.value;
        const value = node.value.value;
        this.contextHandler(value, {
          data() {
            // 默认将ref传递出去
            provideValue = value;
          },
          prop() {
            provideValue = `props.${value}`;
          },
        });
        return res + `const ${key} = provide('${node.value.value}',${provideValue})`;
      }
      return res;
    }, '');
  }

  /**
   * @description TODO 这里暂时只对mixin做最简单的处理, 后续考虑添加对其他文件解析的能力, 并将解析结果同时作为上下文(消除this)
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  mixin(nodeList) {
    this.mixinCode = nodeList.reduce((res, node) => {
      if (t.isIdentifier(node)) {
        return res + `const {/* TODO hooks */} = ${node.name}()\n`;
      }
      return res;
    }, '');
  }
}



