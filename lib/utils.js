/**
 * @param {string} str
 * @return {string}
 */
export function upperCaseFirstChar(str) {
  if (!str.length) return str;
  return str[0].toUpperCase() + str.substring(1);
}
