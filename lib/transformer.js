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
 * |Record<'async',boolean>
 * } AstNode
 */

export class Transformer {
  dataSet = new Set();
  propSet = new Set();
  injectSet = new Set();
  methodSet = new Set();
  computedSet = new Set();
  lifeCycleSet = new Set();

  hasNextTick = false;
  hasUnref = false;

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
      this.mixinCode,
      this.propCode,
      this.dataCode,
      this.injectNode,
      this.computedCode,
      this.methodCode,
      this.watchCode,
      this.provideNode,
      this.lifeCycleNode
    ].reduce((res, code) => {
      return res + (code ? `${code}\n` : '');
    }, '');
  }

  get allDepsCode() {
    return [
      this.getVueDependencies(),
      this.depCode
    ].reduce((res, code) => {
      return res + (code ? `${code}\n` : '');
    }, '');
  }

  assembleSFC(template) {
    return `${template}\n<script lang="ts" setup>
${this.allDepsCode}\n
${this.code}
</script>`;
  }

  assembleHook(hookName) {
    return `${this.allDepsCode}export function ${hookName}(){
${this.code}
return {
${[...this.dataSet, ...this.injectSet, ...this.computedSet, ...this.methodSet]}
}
}`;
  }

  /**
   * @description 执行代码转换
   */
  transform() {
    const { deps, data, watch, props, mixins, methods, computed, injects, provides, lifeCycles } = this.collector;

    this.dep(deps);
    this.data(data);
    this.prop(props);
    this.inject(injects);
    this.provide(provides);
    this.computed(computed);
    this.method(methods);
    this.mixin(mixins);
    this.lifeCycle(lifeCycles);
    this.watch(watch);
  }

  getVueDependencies() {
    const { data, props, watch, computed, injects, provides } = this.collector;
    let deps = [];
    data.length && deps.push('ref');
    props.length && deps.push('defineProps');
    computed.length && deps.push('computed');
    injects.length && deps.push('inject');
    provides.length && deps.push('provide');
    watch.length && deps.push('watch');
    this.lifeCycleSet.size && deps.push(...this.lifeCycleSet);
    this.hasNextTick && deps.push('nextTick');
    this.hasUnref && deps.push('unref');
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
      case this.dataSet.has(key) || this.computedSet.has(key): {
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
      case this.methodSet.has(key): {
        handler.method?.();
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
   * @description 将函数中的this转化为上下文中的this,同时添加默认类型any
   * @param {string} source
   * @return {string}
   */
  functionSerialize(source) {
    const bodyAst = parser.parse(source);
    const initParamType = this.initParamType.bind(this);
    const getExpression = (type = 'memberExpression') => {
      return (path) => {
        const { node } = path;
        const { code } = transformer.transformFromAst(bodyAst, {});
        if (t.isThisExpression(node.object)) {
          const connected = this.contextHandler(node.property.name, {
            data: () => {
              path.replaceWith(t[type](
                t.identifier(node.property.name),
                t.identifier('value'),
                undefined,
                type === 'optionalMemberExpression'));
            },
            prop: () => {
              path.replaceWith(t[type](
                t.identifier('props'),
                t.identifier(node.property.name),
                undefined,
                type === 'optionalMemberExpression'));
            },
            inject: () => {
              path.replaceWith(t[type](
                t.identifier(node.property.name),
                t.identifier('value'),
                undefined,
                type === 'optionalMemberExpression'));
              path.node.object.leadingComments = [{
                type: "CommentBlock",
                value: ` TODO If "${node.property.name}" is not a Ref ,you should remove .value `
              }];
            },
            method: () => {
              path.replaceWith(t.identifier(node.property.name));
            },
            $set: () => {
              path.replaceWith(t[type](
                t.identifier('Reflect'),
                t.identifier('set'),
                undefined,
                type === 'optionalMemberExpression'));
            },
            $nextTick: () => {
              path.replaceWith(t.identifier('nextTick'));
              this.hasNextTick = true;
            }
          });
          if (!connected) {
            node.object.leadingComments = [{
              type: 'CommentBlock',
              value: ` TODO: reference of ${node.property.name} `
            }];
          }
        }
      };
    };
    traverse.default(bodyAst, {
      MemberExpression: getExpression(),
      OptionalMemberExpression: getExpression('optionalMemberExpression'),
      // 自动为函数入参添加any
      ArrowFunctionExpression: initParamType,
      ObjectMethod: initParamType,
      FunctionDeclaration: initParamType
    });
    const { code } = transformer.transformFromAst(bodyAst, {});
    return code.replace(/;$/, '');
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
        } else if (t.isAssignmentPattern(paramNode)) {
          paramNode.left.name = `${paramNode.left.name}:any`;
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
    nodeList.forEach(node => {
      this.methodSet.add(node.key.name);
    });
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
      if (node.async) {
        methodSource = `async ${methodSource}`;
      }
      return res + this.functionSerialize(methodSource) + '\n\n';
    }, ``);
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  computed(nodeList) {
    this.computedCode = nodeList.reduce((res, node) => {
      if (t.isObjectMethod(node)) {
        const key = this.getNodeSource(node.key);
        const source = `const ${key} = computed((${node.params.map(p => {
          return this.getNodeSource(p);
        })})=>${this.getNodeSource(node.body)}
      )`;
        this.computedSet.add(key);
        return res + this.functionSerialize(source);
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

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  lifeCycle(nodeList) {
    this.lifeCycleNode = nodeList.reduce((res, node) => {
      if (t.isObjectMethod(node)) {
        const key = node.key.name;
        const code = this.functionSerialize(`()=>${this.getNodeSource(node.body)}`);
        if (['beforeCreate', 'created'].includes(key)) {
          return res + `/* ${key} */\n;(${code.replace(/;$/, '')})();\n\n`;
        }
        const lifeCycleName = `on${upperCaseFirstChar(key)}`;
        this.lifeCycleSet.add(lifeCycleName);
        return res + `${lifeCycleName}(${code.replace(/;$/, '')})\n\n`;
      }
      return res;
    }, '');
  }

  /**
   * @param {Array<AstNode>} nodeList
   * @returns {string}
   */
  watch(nodeList) {
    this.watchCode = nodeList.reduce((res, node) => {
      let traverse = '', handler = '', options = [], async = false;

      if (this.propSet.has(node.key.name)) {
        traverse = `()=>props.${node.key.name}`;
      } else {
        traverse = `()=>unref(${node.key.name})`;
        this.hasUnref = true;
      }

      if (t.isObjectMethod(node)) {
        handler = `(${node.params.map(p => p.name)})=>${this.getNodeSource(node.body)}`;
        async = node.async;
      } else if (t.isObjectProperty(node) && t.isObjectExpression(node.value)) {
        const { value } = node;
        value.properties.forEach(property => {
          if (property.key.name === 'handler' && t.isObjectMethod(property)) {
            handler = `(${property.params.map(p => p.name)})=>${this.getNodeSource(property.body)}`;
            async = property.async;
          } else if (t.isObjectProperty(property)) {
            options.push(`${property.key.name}:${property.value.value}`);
          }
        });
      }

      return res + `watch(${traverse},${this.functionSerialize(`${async ? 'async ' : ''}${handler}`)}${options.length ? `,\n{${options}}\n` : ''})\n`;
    }, '');
  }
}
