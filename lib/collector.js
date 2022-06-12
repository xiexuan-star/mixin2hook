import traverse from '@babel/traverse';
import t from '@babel/types';
import * as babel from '@babel/core';
import parser from '@babel/parser';

function useImportDeclaration() {
  const deps = [];
  return {
    deps,
    ImportDeclaration({ node }) {
      deps.push(node);
    }
  };
}

const lifeCycleList = [
  'beforeCreate',
  'created',
  'beforeMount',
  'mounted',
  'beforeUpdate',
  'updated',
  'beforeDestroy',
  'destroyed',
  'activated',
  'deactivated'
];

function useObjectProperty() {
  const methods = [];
  const props = [];
  const computed = [];
  const injects = [];
  const provides = [];
  const mixins = [];
  return {
    methods,
    computed,
    props,
    injects,
    provides,
    mixins,
    ObjectProperty({ node }) {
      const { key: { name } } = node;
      switch (name) {
        case 'methods': {
          methods.push(...node.value.properties);
          break;
        }
        case 'computed': {
          computed.push(...node.value.properties);
          break;
        }
        case 'props': {
          props.push(...node.value.properties);
          break;
        }
        case 'provide': {
          provides.push(...node.value.properties);
          break;
        }
        case 'mixins': {
          if (t.isArrayExpression(node.value)) {
            mixins.push(...node.value.elements);
          }
          break;
        }
        case 'inject': {
          if (t.isObjectExpression(node.value)) {
            injects.push(...node.value.properties);
          } else if (t.isArrayExpression(node.value)) {
            injects.push(...node.value.elements);
          }
          break;
        }
      }
    }
  };
}

function useObjectMethod() {
  const data = [];
  const lifeCycles = [];
  return {
    data,
    lifeCycles,
    ObjectMethod({ node }) {
      const { key: { name } } = node;
      if (name === 'data') {
        const returnStatement = node.body.body.filter(n => t.isReturnStatement(n))[0];
        if (returnStatement && t.isObjectExpression(returnStatement.argument)) {
          data.push(...returnStatement.argument.properties.filter(n => t.isObjectProperty(n)));
        }
      } else if (lifeCycleList.includes(name)) {
        lifeCycles.push(node);
      }
    }
  };
}

export class Collector {

  /**
   * @param {string} source
   */
  constructor(source) {
    this.source = source;
  }

  /**
   * @description 生成ast
   */
  parseAst() {
    const { code } = babel.transform(this.source, { presets: ['@vue/babel-preset-jsx'] });
    this.ast = parser.parse(code, { sourceType: 'module' });
    this.source = code;
  }

  /**
   * @description 执行节点收集任务并将结果合并至实例当中
   */
  collect() {
    if (!this.ast) this.parseAst();
    const { methods, props, computed, mixins, injects, provides, ObjectProperty } = useObjectProperty();
    const { data, lifeCycles, ObjectMethod } = useObjectMethod();
    const { deps, ImportDeclaration } = useImportDeclaration();

    traverse.default(this.ast, {
      ObjectProperty,
      ObjectMethod,
      ImportDeclaration
    });

    this.methods = methods;
    this.computed = computed;
    this.props = props;
    this.data = data;
    this.deps = deps;
    this.injects = injects;
    this.provides = provides;
    this.mixins = mixins;
    this.lifeCycles = lifeCycles;
  }
}
