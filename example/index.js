// import { mapGetters } from 'vuex';
import validate from "../../table-item/validate-rules";
import { formEvent } from "../../table-item/index";
import { formCommom } from "../../table-mixins/index";
import boundDate from "./bound-date";
import vexutils from '@/utils/vexutils';

export default {
  mixins: [validate, formEvent, formCommom, boundDate],
  components: {},
  data() {
    return { rowData: {} };
  },
  inject: {
    formTable: {
      type: Object,
      default: () => ({})
    }
  },
  props: {
    mainForm: {
      type: Object,
      default: () => ({})
    },
    userInfo: {
      type: Object,
      default: () => ({})
    },
    styleSetting: {
      type: Object,
      default: () => ({})
    },
    defaultValue: {
      type: Object,
      default: () => {
        return {};
      }
    },
    dbParams: {
      type: Object
    },
    row: {
      type: Object,
      default: () => {
        return {};
      }
    },
    item: {
      type: Object,
      default: () => {
        return {
          _own: {}
        };
      }
    },
    defaultFieldList: {
      type: Array,
      default: () => {
        return [];
      }
    },
    cacheUniqueKey: {
      type: Object,
      default: () => {
        return {
          _own: {}
        };
      }
    },
    params_formId: [String, Number],
    formType: {
      type: Object,
      default: () => {
        return {
          _own: {}
        };
      }
    },
    isDetail: {
      type: Boolean,
      default: false
    },
    handleFormTableValue: Function
  },
  beforeCreate() {
    // this.formFieldListCopy = [];
  },
  mounted() {
    this.$nextTick(() => {
      this.defaultInit();
    });
  },
  computed: {
    hasErr() {
      let key = `__${this.item.val_key}-errorMsg__`;
      let err = this.item?.[key];
      return err;
    }
  },
  methods: {
    async hanldegetUniqueKey(id) {
      await (this.cacheUniqueKey[id] + this.hasErr);
    },
    handleSysParams(str) {
      // let sysData = this.userInfo.map.sysParams;
      let p = {
        form: { ...this.defaultValue },
        sys: this?.userInfo?.map?.sysParams || {},
        db: { ...(this.dbParams || {}) }
      };
      str = vexutils.handleSysParams(str, p);
      if ((!str && str != 0) || ["undefined", "null"].includes(str)) {
        str = "";
      }
      return str;
    },
    defaultInit() {
      const { validate = {}, name, default_val, html_type } = this.item;
      let targetStr = this.defaultValue[name] || default_val;
      targetStr = this.handleSysParams(targetStr);
      let isInitBlur = targetStr || String(targetStr) === "0";

      // ???????????? ????????????????????????
      if (html_type == "SEARCH_MORE") {
        isInitBlur = false;
      }
      if (["last_menstrual"].includes(validate.obj_type)) {
        // targetStr && this.handlerInputBlur(this.item, this.$moment(targetStr));
      } else if (["birthday"].includes(validate.obj_type)) {
        // targetStr && this.handleBirthday(this.$moment(targetStr), this.item, true);
      } else if (isInitBlur) {
        // console.log(isInitBlur, "---targetStr---targetStr", name);
        // ???????????????????????????????????????????????????????????????????????????
        // ?????????????????????????????????????????????
        this.handleTableBlur({}, { eventType: "init" });
      }
    },
    handleTableBlur(e, config = {}) {
      console.log("??????----handleTableBlur---handleTableBlur");
      const { validate, html_type, val_key } = this.item;
      let value = this.row[val_key];
      let { validate: isValidate, errorMsg } = this.handleGetRules(value, this.item);
      let key = `__${val_key}-errorMsg__`;
      let err = errorMsg;
      if (isValidate) {
        err = undefined;
      }

      if (this.item.attr === "startDate" || this.item.attr === "endDate") {
        this.isBoundDate(e, this.item);
      }

      // ???????????????
      if (["DIGITAL"].includes(html_type)) {
        this.hanldeOperational(this.item);
      }

      // ??????????????????
      this.$set(this.item, key, err);
      this.$emit("tableBlur", this.item, this.row, config);

      // ??????????????????
      e?.preventDefault && e.preventDefault();
      e?.stopPropagation && e.stopPropagation();
    },
    handleFormParams(str) {
      const { row } = this;
      if (!str) return "";
      return str.replace(/\${(.*?)\}/g, function () {
        var pKey = arguments[1];
        var pls = pKey.split("!");
        var plsList = pls.slice(1);
        var f = plsList.find(v => v || v == 0);
        return row[pls[0]] || f || "";
      });
    },
    // radio????????????
    radioColor() {
      return function (p, isOnlyRead) {
        let def = isOnlyRead ? "#212121" : "rgba(0, 0, 0, 0.65)";
        return p?.color || def;
      };
    },
    /** ?????????????????????????????????
     * @param {Object} ageInfo  {year: 0, day: 108, month: 3}
     */
    handleGetAgeUnit(ageInfo = {}) {
      if (Object.keys(ageInfo || {}).length === 0) {
        return;
      }
      const list = ["year", "month", "day"];

      let f = list.find(v => ageInfo[v] > 0) || "day";
      return f;
    },
    /**
     * ????????????????????????
     * @param {Number} val
     * @param {String} f  year / day / month
     * @param {Object} item
     */
    handleAgeToBirthDay(val, f, item) {
      const fn = (val, key) => this.$moment().subtract(val, key);
      let curVal = fn(val, f);
      if (!curVal?._isAMomentObject) return;
      let mapList = this.hanldeGetTargetList(item);
      let target = mapList.find(v => v.validate && v.validate.obj_type == "birthday");
      if (target) {
        this.hanldeSetFieldsValue(
          {
            [target.val_key]: curVal
          },
          target
        );
      }
    },
    /**
     * ???????????????????????????
     * @param {String} val YEAR ??? MONTH??? DAY
     * @param {Object} item
     * @returns
     */
    changeAgeSelect(val, item) {
      const values = val.toLowerCase();
      const matchAgeItem = this.defaultFieldList.find(
        v => v.html_type == "AGE" && v.validate?.obj_type == "age"
      );
      if (matchAgeItem && matchAgeItem.isFillAge) {
        const mapList = this.defaultFieldList;
        mapList.forEach(v => {
          const { validate, html_type } = v;
          if (validate && validate.obj_type == "age" && html_type == "AGE") {
            item.ageRes = v.ageRes;
            this.hanldeSetFieldsValue(
              {
                [v.val_key]: v.ageRes[values]
              },
              v
            );
          }
        });
      } else {
        if (!this.ageRes) return;
        this.hanldeSetFieldsValue(
          {
            [item.val_key]: this.ageRes[values]
          },
          item
        );
      }
      this.$nextTick(() => {
        this.handleTableBlur();
        // mainForm.form.validateFields([item.val_key]);
      });
    }
  },
  watch: {
    isDetail(value) {
      console.log(value);
    },
    async rowData(value) {
      await console.log(value);
    },
    hasErr: {
      async handler(value) {
        console.log(value);
      },
      deep: true
    }
  }
};
