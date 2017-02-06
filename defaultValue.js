var checkType = (type, obj) => type === undefined || type === typeof obj;

exports.hasValue = function (type, obj) {

    if (checkType("object", obj)) {
        for (let i = 2; i < arguments.length; ++i) {
            obj = obj[arguments[i]];
            if (checkType("object", obj) && i !== arguments.length - 1) {
                return false;
            }
        }
        return checkType(type, obj);
    }
    else {
        return arguments.length === 2 && checkType(type, obj);
    }
};

exports.value = function (type, value, obj) {

    if (checkType("object", obj)) {
        for (let i = 3; i < arguments.length; ++i) {
            obj = obj[arguments[i]];
            if (i !== arguments.length - 1 && !checkType("object", obj)) {
                obj = undefined;
                break;
            }
        }

        return checkType(type, obj) ? obj : value;
    }
    else {
        return arguments.length === 3 && checkType(type, obj) ? obj : value;
    }
};
