
//  Validator for SQL statements. 
// Only allow INSERT and SELECT on 'patient' table.

//return true if any forbidden words appear in the SQL string
function isForbidden(sql) {
  return /\b(update|delete|drop|alter|truncate|grant|revoke|attach|detach|pragma)\b/i.test(sql);
}

//return true if the SQL string is a SELECT statement
function isSelect(sql) {
  return /^\s*select\b/i.test(sql);
}

function isInsert(sql) {
  return /^\s*insert\b/i.test(sql);
}

//return true if the SQL string references the 'patient' table
function touchesPatient(sql) {
  return /\bpatient\b/i.test(sql);
}

module.exports = { isForbidden, isSelect, isInsert, touchesPatient };
