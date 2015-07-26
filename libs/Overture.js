"use strict";

// -------------------------------------------------------------------------- \\
// File: Core.js                                                              \\
// Module: Core                                                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global window, O */

/**
    Module: Core

    The Core module defines 'O', the global namespace to contain this library,
    and augments it with a few helper methods. It also contains extensions to
    the default types and class creation functionality.
*/
/**
    Namespace: O

    The only new global variable introduced by the library. All Classes and
    Functions are stored under this namespace.
*/
if ( typeof O === 'undefined' ) {
    window.O = {};
}

( function ( NS ) {


/**
    Method: O.meta

    Returns an object representing the metadata for the given object. This has
    the following properties:

    object        - The original object the metadata is for. A metadata object
                    may be shared with other objects for which the original
                    object is the prototype until they need to write to it. This
                    reference is used to detect whether the metadata is
                    inherited, as it's quicker than using Object#hasOwnProperty.
    dependents    - A mapping of keys in the object to computed properties that
                    depend on them. This only maps to direct dependents and is
                    constructed as the computed properties are added to the
                    object. This is shared with the prototype object (even after
                    a separate metadata object has been created) until a new
                    computed property is added or removed from the object, at
                    which point it is cloned so the modifications do not affect
                    the parent object.
    allDependents - A mapping of keys in the object to the full set of computed
                    properties that depend on them, even indirectly. This is
                    shared with the prototype object (even after a separate
                    metadata object has been created) until a new computed
                    property is added or removed from the object.
                    The allDependents map is calculated lazily as required; you
                    should use the <O.ComputedProps#propertiesDependentOnKey>
                    method to fetch the list.
    cache         - A mapping of keys to the last returned value of cacheable
                    computed properties.
    observers     - A mapping of keys to an array of observers for that key.
                    Event listeners are also in  here, mapped from a key of
                    '__event__' + the event type.
    changed       - Null, or if the depth property is >1, an object mapping keys
                    or properties that have changed value, to an object holding
                    the old and possibly the new value.
    depth         - The number of calls to
                    <O.ObservableProps#beginPropertyChanges> without a
                    corresponding call to <O.ObservableProps#endPropertyChanges>.
    pathObservers - A mapping of keys to a list of paths they observe.
    bindings      - A mapping of keys to Binding objects.
    inits         - A mapping of mixin names to a reference count of the number
                    of properties requiring a call to its init/destroy methods.
    isInitialised - Boolean: have the necessary init methods been called?

    For example:

        {
            object: {
                w: O.bind( 'z.b' ),
                x: 5,
                y: function () {
                    return this.get( 'x' ) * 2;
                }.property( 'x' ),
                z: function () {
                    [...]
                }.property( 'y' ),
                onX: function () {
                    [...]
                }.observes( 'x', 'z.a' )
            },
            dependents: {
                x: [ 'y' ],
                y: [ 'z' ]
            },
            allDependents: {
                x: [ 'y', 'z' ]
                // Note, in this example 'y' has not yet been calculated, since
                // it has not been required yet.
            },
            cache: {
                y: 10
            },
            observers: {
                x: [ { object: null, method: 'onX' } ]
            },
            changed: null,
            depth: 0,
            pathObservers: {
                onX: [ 'z.a' ]
            },
            bindings: {
                w: Binding
            },
            inits: {
                Bindings: 1,
                Observers: 1
            },
            isInitialised: true
        }

    Parameters:
        object - {Object} The object to fetch the metadata for.

    Returns:
        {Object} The metadata for the object.
*/

var Metadata = function ( object ) {
    this.object = object;
    this.dependents = {};
    this.allDependents = {};
    this.cache = {};
    this.observers = {};
    this.changed = null;
    this.depth = 0;
    this.pathObservers = {};
    this.bindings = {};
    this.inits = {};
    this.isInitialised = false;

    object.__meta__ = this;
};

var meta = NS.meta = function ( object ) {
    var data = object.__meta__;
    if ( !data ) {
        data = new Metadata( object );
    } else if ( data.object !== object ) {
        // Until the set of computed properties on the object changes, the
        // 'dependents' information is identical to that of the parent so
        // can be shared. The computed 'allDependents will be calculated
        // when needed and stored in the parent meta object, so be available
        // to all other objects of the same type. The dependents property
        // is copied on write (and the allDependents then reset and
        // calculated separately for the object).
        data = Object.create( data );
        data.object = object;

        // The cache should always be separate.
        data.cache = {};

        // Inherit observers, bindings and init/destructors.
        // The individual properties in these objects will be copied on
        // write, leaving any unaltered properties shared with the parent.
        // Path observers are rare enough that we don't waste time and space
        // creating a new object here, but rather wait until a write is made
        // to data.pathObservers, at which point the inheriting object is
        // created.
        data.observers = Object.create( data.observers );
        data.changed = null;
        data.depth = 0;
        data.bindings = Object.create( data.bindings );
        data.inits = Object.create( data.inits );

        object.__meta__ = data;
    }
    return data;
};

/**
    Method: O.guid

    Returns a unique ID (within the scope of this instance of the application)
    for the item passed in.

    Parameters:
        item - {*} The item to get an id for.

    Returns:
        {String} The id for the item.
*/
var guid = 0;
NS.guid = function ( item ) {
    if ( item === null ) {
        return 'null';
    }
    switch ( typeof item ) {
        case 'boolean':
            return item ? 'true' : 'false';
        case 'number':
            return 'num:' + item.toString( 36 );
        case 'string':
            return 'str:' + item;
        case 'undefined':
            return 'undefined';
    }
    if ( item instanceof Date ) {
        return 'date:' + (+item);
    }
    return item.__guid__ || ( item.__guid__ =
        'id:' + ( guid += 1 ).toString( 36 )
    );
};

/**
    Method: O.mixin

    Add properties to an object, doing the necessary setup and teardown to
    ensure special properties (computed, bound, observed etc.), are registered
    correctly.

    Parameters:
        object         - {Object} The object to add properties to.
        extras         - {Object} The extra properties to add.
        doNotOverwrite - {Boolean} If true, if there is a existing property in
                         object with the same name as one in extras, it won't be
                         added to the object.

    Returns:
        {Object} Returns the object parameter.
*/
var mix = NS.mixin = function ( object, extras, doNotOverwrite ) {
    if ( extras ) {
        var force = !doNotOverwrite,
            key, old, value, metadata;

        for ( key in extras ) {
            if ( key !== '__meta__' &&
                    ( force || !object.hasOwnProperty( key ) ) ) {
                old = object[ key ];
                value = extras[ key ];
                if ( old && old.__teardownProperty__ ) {
                    if ( !metadata ) { metadata = meta( object ); }
                    old.__teardownProperty__( metadata, key, object );
                }
                if ( value && value.__setupProperty__ ) {
                    if ( !metadata ) { metadata = meta( object ); }
                    value.__setupProperty__( metadata, key, object );
                }
                object[ key ] = value;
            }
        }
    }
    return object;
};

/**
    Function: O.extend

    Add all properties of one object to another, overwriting any existing
    properties with the same name, unless the doNotOverwrite parameter is set.
    Only adds properties actually on the object, not any properties on the
    prototype chain.

    Parameters:
        base           - {Object} The object to be extended.
        extras         - {Object} The object whose properties are to be added to
                         base.
        doNotOverwrite - {Boolan} (optional) If true, will not overwrite a
                         property on the base object with the property of the
                         same name on the extras object.

    Returns:
        {Object} Returns base.
*/
var extend = NS.extend = function ( base, extras, doNotOverwrite ) {
    for ( var key in extras ) {
        if ( extras.hasOwnProperty( key ) &&
                ( !doNotOverwrite || !base.hasOwnProperty( key ) ) ) {
            base[ key ] = extras[ key ];
        }
    }
    return base;
};

/**
    Function: O.merge

    Add all properties of one object to another, recursively merging if a key
    corresponds to another object on both 'base' and 'extras' objects. Only adds
    properties actually on the object, not any properties on the prototype
    chain.

    Parameters:
        base   - {Object} The object to be extended.
        extras - {Object} The object whose properties are to be merged into
                 base.

    Returns:
        {Object} Returns base.
*/
var merge = NS.merge = function ( base, extras ) {
    for ( var key in extras ) {
        if ( extras.hasOwnProperty( key ) ) {
            if ( base.hasOwnProperty( key ) &&
                    base[ key ] && extras[ key ] &&
                    typeof base[ key ] === 'object' &&
                    typeof extras[ key ] === 'object' ) {
                merge( base[ key ], extras[ key ] );
            } else {
                base[ key ] = extras[ key ];
            }
        }
    }
    return base;
};

/**
    Function: O.clone

    Creates a deep copy of a value. Only works on native JS types; do not use
    with DOM objects or custom objects.

    Parameters:
        value - {*} The value to be copied.

    Returns:
        {*} The clone of the value.
*/
var clone = NS.clone = function ( value ) {
    var cloned = value,
        l, key;
    if ( value && typeof value === 'object' ) {
        if ( value instanceof Array ) {
            cloned = [];
            l = value.length;
            while ( l-- ) {
                cloned[l] = clone( value[l] );
            }
        } else if ( value instanceof Date ) {
            cloned = new Date( value );
        } else {
            cloned = {};
            for ( key in value ) {
                cloned[ key ] = clone( value[ key ] );
            }
        }
    }
    return cloned;
};

/**
    Function: O.isEqual

    Compares two values to see if they are equal. Will *only* work with basic
    JavaScript types (i.e. the ones that can be encoded in JSON).

    Parameters:
        a - {*} The first value.
        b - {*} The second value.

    Returns:
        {Boolean} Are the values equal, i.e. are they identical primitives, or
        are the both arrays or objects with equal members?
*/
var isEqual = NS.isEqual = function ( a, b ) {
    var i, l, key, constructor;
    if ( a === b ) {
        return true;
    }
    if ( a && b && typeof a === 'object' && typeof b === 'object' ) {
        if ( a instanceof Array ) {
            if ( b instanceof Array && a.length === b.length ) {
                for ( i = 0, l = a.length; i < l; i += 1 ) {
                    if ( !isEqual( a[i], b[i] ) ) {
                        return false;
                    }
                }
                return true;
            }
        } else if ( a instanceof Date ) {
            return ( +a === +b );
        } else {
            constructor = a.constructor;
            if ( a.constructor !== b.constructor ) {
                return false;
            }
            if ( constructor.isEqual ) {
                return constructor.isEqual( a, b );
            }
            for ( key in a ) {
                if ( !isEqual( a[ key ], b[ key ] ) ) {
                    return false;
                }
            }
            for ( key in b ) {
                if ( !isEqual( a[ key ], b[ key ] ) ) {
                    return false;
                }
            }
            return true;
        }
    }
    return false;
};

/**
    Function: O.Class

    The Class function takes an object containing the instance functions for a
    new class and returns a constructor function with each of these methods in
    its prototype. It also supports inheritance and mixins, via the special
    Extends and Mixin properties respectively.

    The returned constructor function will be the init method passed in the
    params. If the prototype has no function with the name 'init', an empty
    function will be used, or if the class inherits, then the superclass init
    function will be called.

    For example:

        > var MyClass = O.Class({ sayBoo: function (){ alert( 'boo' ); } });
        > var instance = new MyClass();
        > instance.sayBoo(); // Alerts 'boo'.

    Parameters:
        params - {Object} An object containing methods or properties
                 to configure this class.

    Returns:
        {Constructor} The constructor function for the new class.
*/
NS.Class = function ( params ) {
    var parent = params.Extends,
        mixins = params.Mixin,
        init = params.init || ( parent ?
            function () { parent.apply( this, arguments ); } :
            function () {} ),
        proto, i, l;

    if ( parent ) {
        proto = parent.prototype;
        init.parent = proto;
        init.prototype = Object.create( proto );
        init.prototype.constructor = init;
        delete params.Extends;
    }

    if ( mixins ) {
        if ( !( mixins instanceof Array ) ) {
            mixins = [ mixins ];
        }
        for ( i = 0, l = mixins.length; i < l; i += 1 ) {
            init.implement( mixins[i], true );
        }
        delete params.Mixin;
    }

    init.implement( params, true );

    return init;
};

/**
    Function: O.sortByProperties

    Creates a comparison function which takes two objects and returns -1/0/1 to
    indicate whether the first object is before or after the other. Comparison
    is made by considering each of the properties in the array in turn on the
    two objects until the objects have non-equal values for a property. If the
    property values are integer like strings, they will first be converted to
    numbers for comparison. Other strings will be compared case-insensitively.

    Parameters:
        properties - {String[]} The properties to sort the objects by, in
                     order of precedence. Can also supply just a String for one
                     property.

    Returns:
        {Function} This function may be passed to the Array#sort method to
        sort the array of objects by the properties specified.
*/
var isNumber = /^\d+$/;
NS.sortByProperties = function ( properties ) {
    if ( !( properties instanceof Array ) ) {
        properties = [ properties ];
    }
    var l = properties.length;

    return function ( a, b ) {
        var hasGet = !!a.get,
            i, prop, aVal, bVal, type;
        for ( i = 0; i < l; i += 1 ) {
            prop = properties[i];
            aVal = hasGet ? a.get( prop ) : a[ prop ];
            bVal = hasGet ? b.get( prop ) : b[ prop ];
            type = typeof aVal;

            // Must be the same type
            if ( type === typeof bVal ) {
                if ( type === 'boolean' && aVal !== bVal ) {
                    return aVal ? -1 : 1;
                }
                if ( type === 'string' ) {
                    if ( isNumber.test( aVal ) && isNumber.test( bVal ) ) {
                        aVal = +aVal;
                        bVal = +bVal;
                    } else if ( NS.i18n ) {
                        return NS.i18n.compare( aVal, bVal );
                    }
                }
                if ( aVal < bVal ) {
                    return -1;
                }
                if ( aVal > bVal ) {
                    return 1;
                }
            }
        }
        return 0;
    };
};

/**
    Method: Function#implement

    Adds a set of methods or other properties to the prototype of a function, so
    all instances will have access to them.

    Parameters:
        methods - {Object} The methods or properties to add to the prototype.
        force   - {Boolean} Unless this is true, existing methods/properties
                  will not be overwritten.

    Returns:
        {Function} Returns self.
*/
Function.prototype.implement = function ( methods, force ) {
    mix( this.prototype, methods, !force );
    return this;
};

/**
    Method: Function#extend

    Adds a set of static methods/properties to the function.

    Parameters:
        methods - {Object} The methods/properties to add.
        force   - {Boolean} Unless this is true, existing methods/properties
                  will not be overwritten.

    Returns:
        {Function} Returns self.
*/
Function.prototype.extend = function ( methods, force ) {
    extend( this, methods, !force );
    return this;
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Array.js                                                             \\
// Module: Core                                                               \\
// Requires: Core.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

Array.implement({
    /**
        Method: Array#get

        Returns the property of the object with the name given as the only
        parameter.

        Parameters:
            key - {String} The name of the property to return.

        Returns:
            {*} The requested property of this array.
    */
    get: function ( key ) {
        return this[ key ];
    },

    /**
        Method: Array#set

        Sets the value of a given property on the Array.

        Parameters:
            key   - {String} The name of the property to set.
            value - {*} The value to set the property to.

        Returns:
            {Array} Returns self.
    */
    set: function ( key, value ) {
        this[ key ] = value;
        return this;
    },

    /**
        Method: Array#getObjectAt

        Returns the value at a given index in the array.

        Parameters:
            index - {Number} The index of the value to return.

        Returns:
            {*} The value at the given index in this array.
    */
    getObjectAt: function ( index ) {
        return this[ index ];
    },

    /**
        Method: Array#setObjectAt

        Sets the value at a given index in the array.

        Parameters:
            index - {Number} The index at which to set the value.
            value - {*} The value to set at the given index.

        Returns:
            {Array} Returns self.
    */
    setObjectAt: function ( index, value ) {
        this[ index ] = value;
        return this;
    },

    /**
        Method: Array#include

        Adds an item to the end of the array if it is not already present (as
        determined by strict '===' equality).

        Parameters:
            item - {*} The item to add to the array.

        Returns:
            {Array} Returns self.
    */
    include: function ( item ) {
        var i = 0,
            l = this.length;
        while ( i < l && this[i] !== item ) {
            i += 1;
        }
        this[i] = item;
        return this;
    },

    /**
        Method: Array#erase

        Removes all occurrences (as determined by strict '===' equality) of the
        item from the array.

        Parameters:
            item - {*} The item to be removed from the array.

        Returns:
            {Array} Returns self.
    */
    erase: function ( item ) {
        var l = this.length;
        while ( l-- ) {
            if ( this[l] === item ) {
                this.splice( l, 1 );
            }
        }
        return this;
    }
});


// -------------------------------------------------------------------------- \\
// File: Date.js                                                              \\
// Module: Core                                                               \\
// Requires: Core.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var isLeapYear = function ( year ) {
    return (
        ( ( year % 4 === 0 ) && ( year % 100 !== 0 ) ) || ( year % 400 === 0 )
    );
};
var daysInMonths = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

var dateFormat = /^(\d{4}|[+\-]\d{6})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?(?:Z|(?:([+\-])(\d{2})(?::(\d{2}))?)?)?)?$/;

Date.extend({
    fromJSON: function ( value ) {
        /*
            /^
            (\d{4}|[+\-]\d{6})      // 1. Year
            (?:
                -(\d{2})            // 2. Month
                (?:
                    -(\d{2})        // 3. Day
                )?
            )?
            (?:
                T(\d{2}):(\d{2})    // 4. Hour : 5. Minutes
                (?:
                    :(\d{2})        // 6. Seconds
                    (?:
                        \.(\d{3})   // 7. Milliseconds
                    )?
                )?
                (?:
                    Z|              // (UTC time)
                    (?:
                        ([+\-])     // 8. +/-
                        (\d{2})     // 9. Hours offset
                        (?:
                            :(\d{2}) // 10. Minutes offset
                        )?
                    )?
                )?
            )?$/;
        */
        var results = value ? dateFormat.exec( value ) : null;
        return results ?
            new Date( Date.UTC(
                +results[1] || 0,            // Year
                ( +results[2] || 1 ) - 1,    // Month
                +results[3] || 1,            // Day
                +results[4] || 0,            // Hours
                +results[5] || 0,            // Minutes
                +results[6] || 0,            // Seconds
                +results[7] || 0             // MS
            ) + ( results[8] ?               // Has offset?
                // +- 1 minute in ms
                ( results[8] === '+' ? -1 : 1 ) * 60000 *
                // Offset in minutes
                ( ( ( +results[9] || 0 ) * 60 ) + ( +results[10] || 0 ) ) :
                // No offset
                0
            )) :
            null;
    },

    getDaysInMonth: function ( month, year ) {
        return ( month === 1 && isLeapYear( year ) ) ?
            29 : daysInMonths[ month ];
    },
    getDaysInYear: function ( year ) {
        return isLeapYear( year ) ? 366 : 365;
    },
    isLeapYear: isLeapYear
});

var pad = function ( num, nopad, character ) {
    return ( nopad || num > 9 ) ? num : ( character || '0' ) + num;
};

var aDay = 86400000; // milliseconds in a day

var duration = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: aDay,
    week: 604800000
};

Date.implement({
    /**
        Method: Date#isToday

        Determines if the point of time represented by the date object is today
        in the current time zone.

        Returns:
            {Boolean} Is the date today?
    */
    isToday: function ( utc ) {
        var now = new Date(),
            date = now.getDate(),
            month = now.getMonth(),
            year = now.getFullYear();
        return utc ?
            this.getUTCFullYear() === year &&
            this.getUTCMonth() === month &&
            this.getUTCDate() === date :
            this.getFullYear() === year &&
            this.getMonth() === month &&
            this.getDate() === date;
    },

    /**
        Method: Date#isOnSameDayAs

        Determines if the two points of time are on the same day. Each date is
        considered in its local time zone, e.g. 10pm GMT on 1/1/2010 would be
        considered the same day as 10pm EST on 1/1/2010, although these are
        different dates if the dates are first converted to the same timezone.

        Parameters:
            date - {Date} Date to compare it to.

        Returns:
            {Boolean} Are the dates on the same day?
    */
    isOnSameDayAs: function ( date, utc ) {
        return utc ?
            date.getUTCFullYear() === this.getUTCFullYear() &&
            date.getUTCMonth() === this.getUTCMonth() &&
            date.getUTCDate() === this.getUTCDate() :
            date.getFullYear() === this.getFullYear() &&
            date.getMonth() === this.getMonth() &&
            date.getDate() === this.getDate();
    },

    /**
        Method: Date#getDayName

        Returns the day of the week for this date in the currently active
        locale, provided the Localisation module is loaded. If this isn't
        loaded, it returns the same as Date#getDay().

        Parameters:
            abbreviate - {Boolean} (optional) If true, the method returns an
                         abbreviated day name instead of the full day name.
            utc        - {Boolean} (optional) If true, the UTC time of this date
                         object will be used when determining the day.

        Returns:
            {String} Localised day name.
    */
    getDayName: function ( abbreviate, utc ) {
        var names = NS.i18n && NS.i18n.get(
                ( abbreviate ? 'abbreviatedD' : 'd' ) + 'ayNames' ),
            day = utc ? this.getUTCDay() : this.getDay();
        return names ? names[ day ] : day;
    },

    /**
        Method: Date#getMonthName

        Returns the month of the year for this date in the currently active
        locale, provided the Localisation module is loaded. If this isn't
        loaded, it returns the same as Date::getMonth().

        Parameters:
            abbreviate - {Boolean} (optional) If true, the method returns an
                         abbreviated month name instead of the full month name.
            utc        - {Boolean} (optional) If true, the UTC time of this date
                         object will be used when determining the day.

        Returns:
            {String} Localised month name.
    */
    getMonthName: function ( abbreviate, utc ) {
        var names = NS.i18n && NS.i18n.get(
                ( abbreviate ? 'abbreviatedM' : 'm' ) + 'onthNames' ),
            day = utc ? this.getUTCMonth() : this.getMonth();
        return names ? names[ day ] : day;
    },

    /**
        Method: Date#getDayOfYear

        Returns the day of the year for this date, where 1 is the 1st January.

        Parameters:
            utc - {Boolean} (optional) If true, the UTC time of this date object
                  will be used when determining the day.

        Returns:
            {Number} The day of the year (1--366).
    */
    getDayOfYear: function ( utc ) {
        var beginningOfYear = utc ?
            Date.UTC( this.getUTCFullYear(), 0, 1 ) :
            +new Date( this.getFullYear(), 0, 1 );
        return ~~( ( this.getTime() - beginningOfYear ) / aDay ) + 1;
    },

    /**
        Method: Date#getWeekNumber

        Returns the week of the year for this date, in the range [00,53], given
        the day of the week on which a week starts (default -> Sunday). The
        first instance of that day in the year is the start of week 1.

        Parameters:
            firstDayOfWeek - {Number} (optional) The day of the week that should
                             be considered the first day of the week.
                             `0` => Sunday (default if none supplied),
                             `1` => Monday etc.
            utc            - {Boolean} (optional) If true, the UTC time of this
                             date object will be used when determining the day.

        Returns:
            {Number} The week of the year (0--53).
    */
    getWeekNumber: function ( firstDayOfWeek, utc ) {
        var day = utc ? this.getUTCDay() : this.getDay(),
            dayOfYear = this.getDayOfYear( utc ) - 1, // Day of the year 0-index
            daysToNext = ( ( firstDayOfWeek || 0 ) - day ).mod( 7 ) || 7;
        return Math.floor( ( dayOfYear + daysToNext ) / 7 );
    },

    /**
        Method: Date#getISOWeekNumber

        Returns the week number of the year (Monday as the first day of the
        week) as a number in the range [01,53]. If the week containing 1 January
        has four or more days in the new year, then it is considered week 1.
        Otherwise, it is the last week of the previous year, and the next week
        is week 1.

        This is how week numbers are defined in ISO 8601.

        Parameters:
            firstDayOfWeek - {Number} (optional) The day of the week that should
                             be considered the first day of the week.
                             `1` => Monday (default if none supplied)
                             `0` => Sunday
                             `6` => Saturday etc.
            utc            - {Boolean} (optional) If true, the UTC time of this
                             date object will be used when determining the day.

        Returns:
            {Number} The week of the year (1--53).
    */
    getISOWeekNumber: function ( firstDayOfWeek, utc ) {
        // The week number of the year (Monday as the first day of
        // the week) as a decimal number [01,53]. If the week containing
        // 1 January has four or more days in the new year, then it is
        // considered week 1. Otherwise, it is the last week of the
        // previous year, and the next week is week 1.
        if ( firstDayOfWeek == null ) { firstDayOfWeek = 1; }

        // 4th January is always in week 1.
        var jan4 = utc ?
                new Date( Date.UTC( this.getUTCFullYear(), 0, 4 ) ) :
                new Date( this.getFullYear(), 0, 4 ),
            jan4WeekDay = utc ? jan4.getUTCDay() : jan4.getDay(),
            // Find Monday before 4th Jan
            wk1Start = jan4 - ( jan4WeekDay - firstDayOfWeek ).mod( 7 ) * aDay,
            // Week No == How many weeks have past since then, + 1.
            week = Math.floor( ( this - wk1Start ) / 604800000 ) + 1,
            date, day;
        if ( week === 53 ) {
            date = utc ? this.getUTCDate() : this.getDate();
            day = utc ? this.getUTCDay() : this.getDay();
            // First day of week must be no greater than 28th December
            if ( date - ( day - firstDayOfWeek ).mod( 7 ) > 28 ) {
                week = 1;
            }
        }
        return week || new Date(
            ( utc ? this.getUTCFullYear() : this.getFullYear() ) - 1, 11, 31, 12
        ).getISOWeekNumber( firstDayOfWeek, false );
    },

    /**
        Method: Date#add

        Moves the date object forward in time by the given delta.

        Parameters:
            number - {Number} How many days/weeks etc. to move forward.
            unit   - {String} (optional) The unit of the first argument. Must be
                     one of 'second'/minute'/'hour'/'day'/'week'/'month'/'year'.
                     If not supplied, defaults to 'day'.

        Returns:
            {Date} Returns self.
    */
    add: function ( number, unit ) {
        if ( unit === 'year' ) {
            this.setFullYear( this.getFullYear() + number );
        } else if ( unit === 'month' ) {
            this.setMonth( this.getMonth() + number );
        } else {
            this.setTime(
                this.getTime() + number * ( duration[ unit || 'day' ] || 0 ) );
        }
        return this;
    },

    /**
        Method: Date#subtract

        Moves the date object backwards in time by the given delta.

        Parameters:
            number - {Number} How many days/weeks etc. to move backwards.
            unit   - {String} (optional) The unit of the first argument. Must be
                     one of 'second'/minute'/'hour'/'day'/'week'/'month'/'year'.
                     If not supplied, defaults to 'day'.

        Returns:
            {Date} Returns self.
    */
    subtract: function ( number, unit ) {
        return this.add( -number, unit );
    },

    /**
        Method: Date#format

        Formats the date as a string, according to the format pattern given.
        A variable to be substituted starts with a %, then optionally a '-'
        to stop it from being 0-padded to a fixed length (if applicable),
        then a character to indicate the desired part of the date. All patterns
        defined in strftime format are supported
        (http://pubs.opengroup.org/onlinepubs/007908799/xsh/strftime.html).

        a - Abbreviated day of the week, e.g. 'Mon'.
        A - Full day of the week, e.g. 'Monday'.
        b - Abbreviated month name, e.g. 'Jan'.
        B - Full month name, e.g. 'January'.
        c - The locale's appropriate date and time representation.
        C - Century number (00-99).
        d - Day of the month (01-31).
        D - Same as '%m/%d/%y'.
        e - Day of the month (' 1'-'31'), padded with a space if single digit.
        h - Same as '%b'.
        H - Hour of the day in 24h clock (00-23).
        I - Hour of the day in 12h clock (01-12).
        j - Day of the year as a decimal number (001-366).
        m - Month of the year (01-12).
        M - Minute of the hour (00-59).
        n - Newline character.
        p - Localised equivalent of AM or PM.
        r - The time in AM/PM notation: '%I:%M:%S %p'.
        R - The time in 24h notation: '%H:%M'.
        S - The second of the minute (00-61).
        t - Tab character.
        T - The time: '%H:%M:%S'.
        u - Weekday (1-7) where Monday is 1.
        U - The week number of the year (Sunday as the first day of the week) as
            a decimal number (00-53). The first Sunday in the year is the start
            of week 1, any day before this in the year is in week 0.
        V - The week number of the year (Monday as the first day of the week) as
            a decimal number (01-53). If the week containing 1 January has four
            or more days in the new year, then it is considered week 1.
            Otherwise, it is the last week of the previous year, and the next
            week is week 1.
        w - Weekday (0-6) where Sunday is 0.
        W - The week number of the year (Monday as the first day of the week) as
            a decimal number (00-53). All days in a new year preceding the first
            Monday are considered to be in week 0.
        x - The locale's appropriate date representation.
        X - The locale's appropriate time representation.
        y - Year without century (00-99).
        Y - Year with century (0-9999)
        Z - Timezone name or abbreviation.
        % - A '%' character.

        Parameters:
            format - {String} The pattern to use as a template for the string.
            utc    - {Boolean} Use UTC time.

        Returns:
            {String} The formatted date string.
    */
    format: function ( format, utc ) {
        var date = this;
        return format ?
            format.replace(/%(\-)?([%A-Za-z])/g,
                function ( string, nopad, character ) {
            var num, str;
            switch ( character ) {
            case 'a':
                // Abbreviated day of the week, e.g. 'Mon'.
                return date.getDayName( true, utc );
            case 'A':
                // Full day of the week, e.g. 'Monday'.
                return date.getDayName( false, utc );
            case 'b':
                // Abbreviated month name, e.g. 'Jan'.
                return date.getMonthName( true, utc );
            case 'B':
                // Full month name, e.g. 'January'.
                return date.getMonthName( false, utc );
            case 'c':
                // The locale's appropriate date and time representation.
                return NS.i18n ?
                    NS.i18n.date( date, 'fullDateAndTime' ) :
                    date.toLocaleString();
            case 'C':
                // Century number (00-99).
                return pad( ~~(
                    ( utc ? date.getUTCFullYear() : date.getFullYear() ) / 100
                ), nopad );
            case 'd':
                // Day of the month (01-31).
                return pad( utc ? date.getUTCDate() : date.getDate(), nopad );
            case 'D':
                // Same as '%m/%d/%y'
                return date.format( '%m/%d/%y', utc );
            case 'e':
                // Day of the month (' 1'-'31'), padded with a space if single
                // digit.
                return pad(
                    utc ? date.getUTCDate() : date.getDate(), nopad, ' ' );
            case 'h':
                // Same as '%b'.
                return date.getMonthName( true, utc );
            case 'H':
                // Hour of the day in 24h clock (00-23).
                return pad( utc ? date.getUTCHours() : date.getHours(), nopad );
            case 'I':
                // Hour of the day in 12h clock (01-12).
                num = utc ? date.getUTCHours() : date.getHours();
                return num ? pad( num < 13 ? num : num - 12, nopad ) : 12;
            case 'j':
                // Day of the year as a decimal number (001-366).
                num = date.getDayOfYear( utc );
                return nopad ? num : num < 100 ? '0' + pad( num ) : pad( num );
            case 'm':
                // Month of the year (01-12).
                return pad(
                    ( utc ? date.getUTCMonth() : date.getMonth() ) + 1, nopad );
            case 'M':
                // Minute of the hour (00-59).
                return pad(
                    ( utc ? date.getUTCMinutes() : date.getMinutes() ), nopad );
            case 'n':
                // Newline character.
                return '\n';
            case 'p':
                // Localised equivalent of AM or PM.
                str = ( utc ? date.getUTCHours() : date.getHours() ) < 12 ?
                    'am' : 'pm';
                return NS.i18n ?
                    NS.i18n.get( str + 'Designator' ) : str.toUpperCase();
            case 'r':
                // The time in AM/PM notation: '%I:%M:%S %p'.
                return date.format( '%I:%M:%S %p', utc );
            case 'R':
                // The time in 24h notation: '%H:%M'.
                return date.format( '%H:%M', utc );
            case 'S':
                // The second of the minute (00-61)
                return pad(
                    utc ? date.getUTCSeconds() : date.getSeconds(), nopad );
            case 't':
                // Tab character.
                return '\t';
            case 'T':
                // The time: '%H:%M:%S'.
                return date.format( '%H:%M:%S', utc );
            case 'u':
                // Weekday (1-7) where Monday is 1.
                return ( utc ? date.getUTCDay() : date.getDay() ) || 7;
            case 'U':
                // The week number of the year (Sunday as the first day of
                // the week) as a decimal number [00,53]. First Sunday in the
                // year is the start of week 1.
                return pad( this.getWeekNumber( 0, utc ), nopad );
            case 'V':
                // The week number of the year (Monday as the first day of
                // the week) as a decimal number [01,53]. If the week containing
                // 1 January has four or more days in the new year, then it is
                // considered week 1. Otherwise, it is the last week of the
                // previous year, and the next week is week 1.
                return pad( this.getISOWeekNumber( 1, utc ), nopad );
            case 'w':
                // Weekday (0-6) where Sunday is 0.
                return utc ? date.getUTCDay() : date.getDay();
            case 'W':
                // The week number of the year (Monday as the first day of
                // the week) as a decimal number [00,53]. All days in a new year
                // preceding the first Monday are considered to be in week 0.
                return pad( this.getWeekNumber( 1, utc ), nopad );
            case 'x':
                // The locale's appropriate date representation.
                return NS.i18n ?
                    NS.i18n.date( date, 'date' ) :
                    date.format( '%d/%m/%y', utc );
            case 'X':
                // The locale's appropriate time representation.
                return NS.i18n ?
                    NS.i18n.date( date, 'time' ) : date.format( '%H:%M', utc );
            case 'y':
                // Year without century (00-99).
                return ( utc ?
                    date.getUTCFullYear() : date.getFullYear()
                ).toString().slice( 2 );
            case 'Y':
                // Year with century (0-9999).
                return utc ? date.getUTCFullYear() : date.getFullYear();
            case 'Z':
                // Timezone name or abbreviation.
                return ( /\((.*)\)/.exec( date.toString() ) || [ '' ] ).pop();
            case '%':
                // A '%' character.
                return character;
            default:
                return string;
            }
        }) : this.toString();
    }
});

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Number.js                                                            \\
// Module: Core                                                               \\
// Requires: Core.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

Number.implement({
    /**
        Method: Number#limit

        Limits the number to be within the given range.

        Parameters:
            min - {Number} The minimum allowed value.
            max - {Number} The maximum allowed value.

        Returns:
            {Number} The nearest number to the current value within the allowed
            range.
    */
    limit: function ( min, max ) {
        // +0 is required to unbox 'this' back into a primitive number in IE.
        // Otherwise you get a boxed value, which amongst other things makes 0 a
        // truthy value, leading to all sorts of interesting behaviour...
        return this < min ? min : this > max ? max : this + 0;
    },

    /**
        Method: Number#mod

        Returns the number mod n.

        Parameters:
            n - {Number}

        Returns:
            {Number} The number mod n.
    */
    mod: function ( n ) {
        var m = this % n;
        return m < 0 ? m + n : m;
    }
});


// -------------------------------------------------------------------------- \\
// File: Object.js                                                            \\
// Module: Core                                                               \\
// Requires: Core.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function () {

Object.extend({
    /**
        Function: Object.values

        Returns an array of values for all enumerable properties defined
        explicitly on the object (not its prototype).

        Parameters:
            object - {Object} The object to get the array of values from.

        Returns:
            {Array} The list of values.
    */
    values: function ( object ) {
        var values = [];
        for ( var key in object ) {
            if ( object.hasOwnProperty( key ) ) {
                values.push( object[ key ] );
            }
        }
        return values;
    },

    /**
        Function: Object.keyOf

        Searches the object and returns the first key it finds which maps to the
        given value (as determined by ===).

        Parameters:
            object - {Object} The object to search.
            value  - {*} The value to search for.

        Returns:
            {String|undefined} The key for that value in the object.
            Undefined is returned if the value is not found.
    */
    keyOf: function ( object, value ) {
        for ( var key in object ) {
            if ( object[ key ] === value ) {
                return key;
            }
        }
    },

    /**
        Function: Object.filter

        Takes two objects and returns a new object which contains all the
        properties of the first for which the same key has a truthy value in the
        second.

        Parameters:
            object   - {Object} The object to copy properties from.
            include  - {Object} The object to check for a truthy key value in
                       before copying the property.

        Returns:
            {Object} The filtered object.
    */
    filter: function ( object, include ) {
        var result = {},
            key;
        for ( key in object ) {
            if ( include[ key ] ) {
                result[ key ] = object[ key ];
            }
        }
        return result;
    },

    /**
        Function: Object.zip

        Takes two arrays and returns an object with keys from the first array
        and values taken from the corresponding position in the second array.

        Parameters:
            keys   - {String[]} The array of keys.
            values - {Array} The array of values.

        Returns:
            {Object} The object mapping keys to values.
    */
    zip: function ( keys, values ) {
        var l = Math.min( keys.length, values.length ),
            obj = {};
        while ( l-- ) {
            obj[ keys[l] ] = values[l];
        }
        return obj;
    },

    /**
        Function: Object.fromQueryString

        Converts a URL query string (the part after the '?') into an object of
        key/value pairs.

        Parameters:
            query - {String} The key/value pairs in query string form.

        Returns:
            {Object} The key/value pairs in object form.
    */
    fromQueryString: function ( query ) {
        var result = {};
        query.split( '&' ).forEach( function ( pair ) {
           var parts = pair.split( '=' ).map( decodeURIComponent );
           result[ parts[0] ] = parts[1];
        });
        return result;
    }
});

}() );


// -------------------------------------------------------------------------- \\
// File: RegExp.js                                                            \\
// Module: Core                                                               \\
// Requires: Core.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/**
    Property: RegExp.email
    Type: RegExp

    A regular expression for detecting an email address.
*/
RegExp.email = /\b([\w\-.%+]+@(?:[\w\-]+\.)+[A-Z]{2,})\b/i;

/**
    Property: RegExp.url
    Type: RegExp

    A regular expression for detecting a url. Regexp by John Gruber, see
    <http://daringfireball.net/2010/07/improved_regex_for_matching_urls>
*/

// /\b
// (?:
//     https?:\/\/|                # URL protocol and colon
//     www\d{0,3}[.]|              # or www.
//     [a-z0-9.\-]+[.][a-z]{2,}\/  # or url like thing followed by a slash
// )
// (?:
//     [^\s()<>]+|                 # Run of non-space, non-()<>{}[]
//     \([^\s()<>]+\)              # or non-space, non-()<>{}[] run inside ()
// )+
// (?:                             # End with:
//     \((?:                       # Balanced parens, one level deep
//         [^\s()<>]+|
//         (?:
//             \([^\s()<>]+\)
//         )
//     )*\)|
//     [^\s`!()\[\]{};:'".,<>?«»“”‘’] # or not a space or one of these punct
// )

RegExp.url = /\b(?:https?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,}\/)(?:[^\s()<>]+|\([^\s()<>]+\))+(?:\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’])/i;


// -------------------------------------------------------------------------- \\
// File: String.js                                                            \\
// Module: Core                                                               \\
// Requires: Core.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( undefined ) {

var splitter =
    /%(\+)?(?:'(.))?(-)?(\d+)?(?:\.(\d+))?(?:\$(\d+))?([%sn@])/g;

String.implement({
    /**
        Method: String#format

        Format a string by substituting in arguments. The method can also add
        padding to make the insertion a fixed width and restrict the number of
        decimal places in a number.

        A placeholder is denoted by a `%` sign, which followed by:

        1. (optional) *Sign*: `+` means always show sign.
        2. (optional) *Padding*: `'c` where `c` is any character. Default is
           space.
        3. (optional) *Alignment*: `-` means make left-aligned (default
           right-align).
        4. (optional) *Width*: Integer specifying number of characters in
           output.
        5. (optional) *Precision*: `.` + Number of digits after decimal point.
        6. (optional) *Argument*: `$` + Number of argument (indexed from 1) to
           use.
        7. *Type*: %, n, s, @.

        If no specific argument is used, the index of a placeholder is used to
        determine which argument to use. The possible argument types are String,
        Number or Object; these must match the placeholder types of 's', 'n' and
        '@' respectively. A literal % is inserted by %%. Objects are converted
        to strings via their toString() method.

        e.g. If the string is `"%+'*-16.3$2n"` and argument 2 is `123.456789`,
        then the output is: `"+123.457********"`.

        Parameters:
            var_args - {...(String|Number|Object)} The arguments to interpolate.

        Returns:
            {String} The formatted string.
    */
    format: function () {
        // Reset RegExp.
        splitter.lastIndex = 0;

        var output = '',
            i = 0,
            argIndex = 1,
            part, data, toInsert, padLength, padChar, padding;

        while ( ( part = splitter.exec( this ) ) ) {
            // Add everything between last placeholder and this placeholder
            output += this.slice( i, part.index );
            // And set i to point to the next character after the placeholder
            i = part.index + part[0].length;

            // Find argument to subsitute in; either the one specified in
            // (6) or the index of this placeholder.
            data = arguments[ ( parseInt( part[6], 10 ) || argIndex ) - 1 ];

            // Generate the string form of the data from the type specified
            // in (7).
            switch ( part[7] ) {
                case '%':
                    // Special case: just output the character and continue;
                    output += '%';
                    continue;
                case 's':
                    toInsert = data;
                    break;
                case 'n':
                    // (1) Ensure sign will be shown
                    toInsert = ( ( part[1] && data >= 0 ) ? '+' : '' );
                    // (5) Restrict number of decimal places
                    toInsert += ( part[5] !== undefined ) ?
                        data.toFixed( part[5] ) : ( data + '' );
                    break;
                case '@':
                    toInsert = data.toString();
                    break;
            }

            // (4) Check minimum width
            padLength = ( part[4] || 0 ) - toInsert.length;
            if ( padLength > 0 ) {
                // Padding character is (2) or a space
                padChar = part[2] || ' ';
                padding = padChar;
                while ( ( padLength -= 1 ) ) {
                    padding += padChar;
                }
                // Insert padding before unless (3) is set.
                if ( part[3] ) {
                    toInsert += padding;
                } else {
                    toInsert = padding + toInsert;
                }
            }

            // And add the string to the output
            output += toInsert;

            // Keep track of the arg index to use.
            argIndex += 1;
        }
        // Add any remaining string
        output += this.slice( i );

        return output;
    },

    /**
        Method: String#repeat

        ES6 method. Repeats the string n times.

        Parameters
            n - {Number} The number of times to repeat the string.
                Must be an integer >= 0.

        Returns:
            {String} The repeated string.
    */
    repeat: function ( n ) {
        var string = this,
            output = '';
        while ( n ) {
            if ( n % 2 === 1 ) {
                output += string;
            }
            if ( n > 1 ) {
                string += string;
            }
            n = n >> 1;
        }
        return output;
    },

    /**
        Method: String#escapeHTML

        Returns the string with the characters <,>,& replaced by HTML entities.

        Returns:
            {String} The escaped string.
    */
    escapeHTML: function () {
        return this.split( '&' ).join( '&amp;' )
                   .split( '<' ).join( '&lt;'  )
                   .split( '>' ).join( '&gt;'  );
    },

    /**
        Method: String#escapeRegExp

        Escape any characters with special meaning when passed to the RegExp
        constructor.

        Returns:
            {String} The escaped string.
    */
    escapeRegExp: function () {
        return this.replace( /([\-.*+?\^${}()|\[\]\/\\])/g, '\\$1' );
    },

    /**
        Method: String#capitalise

        Returns this string with the first letter converted to a capital.

        Returns:
            {String} The capitalised string.
    */
    capitalise: function () {
        return this.charAt( 0 ).toUpperCase() + this.slice( 1 );
    },

    /**
        Method: String#camelCase

        Returns this string with any sequence of a hyphen followed by a
        lower-case letter replaced by the capitalised letter.

        Returns:
            {String} The camel-cased string.
    */
    camelCase: function () {
        return this.replace( /\-([a-z])/g, function ( _, letter ) {
            return letter.toUpperCase();
        });
    },

    /**
        Method: String#hyphenate

        Returns this string with any captials converted to lower case and
        preceded by a hyphen.

        Returns:
            {String} The hyphenated string.
    */
    hyphenate: function () {
        return this.replace( /[A-Z]/g, function ( letter ) {
            return ( '-' + letter.toLowerCase() );
        });
    },

    /**
        Method: String#contains

        Tests whether the string contains the value supplied. If a seperator is
        given, the value must have at either end one of: the beginning of the
        string, the end of the string or the separator.

        Parameters:
            string - {String} The value to search for.
            separator - {String} (optional) The separator string.

        Returns:
            {Boolean} Does this string contain the given string?
    */
    contains: function ( string, separator ) {
        return ( separator ?
            ( separator + this + separator ).indexOf(
                separator + string + separator ) :
            this.indexOf( string ) ) > -1;
    },

    /**
        Method: String#hash

        Hashes the string to return a number which should (in theory at least)
        be statistically randomly distributed over any set of inputs, and each
        change in a bit of input should result in a change in roughly 50% of the
        bits in the output. Algorithm from:
        <http://www.azillionmonkeys.com/qed/hash.html>

        Returns:
            {Number} The hash. This is a *signed* 32-bit int.
    */
    hash: function () {
        var hash = this.length,
            remainder = hash & 1,
            l = hash - remainder;

        for ( var i = 0; i < l; i += 2 ) {
            hash += this.charCodeAt( i );
            hash = ( hash << 16 ) ^
                ( ( this.charCodeAt( i + 1 ) << 11 ) ^ hash );
            hash += hash >> 11;
        }

        if ( remainder ) {
            hash += this.charCodeAt( l );
            hash ^= hash << 11;
            hash += hash >> 17;
        }

        // Force "avalanching" of final 127 bits
        hash ^= hash << 3;
        hash += hash >> 5;
        hash ^= hash << 4;
        hash += hash >> 17;
        hash ^= hash << 25;
        hash += hash >> 6;

        return hash;
    },

    /**
        Method: String#md5

        Calculates the MD5 hash of the string.
        See <http://en.wikipedia.org/wiki/MD5>.

        Returns:
            {String} The 128 bit hash in the form of a hexadecimal string.
    */
    md5: ( function () {
        var r = [
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
        ];

        var k = [
            0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
            0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
            0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
            0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
            0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
            0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
            0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
            0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
            0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
            0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
            0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
            0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
            0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
            0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
            0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
            0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
        ];

        var utf16To8 = function ( string ) {
            var utf8 = '',
                i, l, c;
            for ( i = 0, l = string.length; i < l; i += 1 ) {
                c = string.charCodeAt( i );
                if ( c < 128 ) {
                    utf8 += string.charAt( i );
                } else if ( c < 2048 ) {
                    utf8 += String.fromCharCode( ( c >> 6 ) | 192 );
                    utf8 += String.fromCharCode( ( c & 63 ) | 128 );
                } else {
                    utf8 += String.fromCharCode( ( c >> 12 ) | 224 );
                    utf8 += String.fromCharCode( ( ( c >> 6 ) & 63 ) | 128 );
                    utf8 += String.fromCharCode( ( c & 63 ) | 128 );
                }
            }
            return utf8;
        };

        var stringToWords = function ( string ) {
            // Each character is 8 bits. Pack into an array of 32 bit numbers
            // then pad the end as specified by the MD5 standard: a single one
            // bit followed by as many zeros as need to make the length in bits
            // === 448 mod 512, then finally the length of the input, in bits,
            // as a 64 bit little-endian long int.
            var length = string.length,
                blocks = [ 0 ],
                i, j, k, padding;
            for ( i = 0, j = 0, k = 0; j < length; j += 1 ) {
                blocks[i] |= string.charCodeAt( j ) << k;
                k += 8;
                if ( k === 32 ) {
                    k = 0;
                    blocks[ i += 1 ] = 0;
                }
            }
            blocks[i] |= 0x80 << k;
            i += 1;

            padding = i + 16 - ( ( ( i + 2 ) % 16 ) || 16 );
            for ( ; i < padding ; i += 1 ) {
                blocks[i] = 0;
            }

            // Each char is 8 bits.
            blocks[i] = length << 3;
            blocks[ i + 1 ] = length >>> 29;

            return blocks;
        };

        // Add unsigned 32 bit ints with overflow.
        var add = function ( a, b ) {
            var lsw = ( a & 0xffff ) + ( b & 0xffff ),
                msw = ( a >> 16 ) + ( b >> 16 ) + ( lsw >> 16 );
            return ( msw << 16 ) | ( lsw & 0xffff );
        };

        var leftRotate = function ( a, b ) {
            return ( a << b ) | ( a >>> ( 32 - b ) );
        };

        var hexCharacters = '0123456789abcdef';
        var hex = function ( number ) {
            var string = '',
                i;
            for ( i = 0; i < 32; i += 8 ) {
                string += hexCharacters[ ( number >> i + 4 ) & 0xf ];
                string += hexCharacters[ ( number >> i ) & 0xf ];
            }
            return string;
        };

        return function () {
            var words = stringToWords( utf16To8( this ) ),
                h0 = 0x67452301,
                h1 = 0xEFCDAB89,
                h2 = 0x98BADCFE,
                h3 = 0x10325476,
                i, j, l, a, b, c, d, f, g, temp;

            for ( j = 0, l = words.length; j < l; j += 16 ) {
                a = h0;
                b = h1;
                c = h2;
                d = h3;

                for ( i = 0; i < 64; i += 1 ) {
                    if ( i < 16 ) {
                        f = ( b & c ) | ( (~b) & d );
                        g = i;
                    }
                    else if ( i < 32 ) {
                        f = ( d & b ) | ( (~d) & c );
                        g = ( ( 5 * i ) + 1 ) % 16;
                    }
                    else if ( i < 48 ) {
                        f = b ^ c ^ d;
                        g = ( ( 3 * i ) + 5 ) % 16;
                    }
                    else {
                        f = c ^ ( b | (~d) );
                        g = ( 7 * i ) % 16;
                    }
                    temp = d;
                    d = c;
                    c = b;
                    b = add( b,
                            leftRotate(
                                add( a,
                                    add( f,
                                        add( k[i], words[ j + g ] )
                                    )
                                ),
                                r[i]
                            )
                        );
                    a = temp;
                }

                h0 = add( h0, a );
                h1 = add( h1, b );
                h2 = add( h2, c );
                h3 = add( h3, d );
            }

            return hex( h0 ) + hex( h1 ) + hex( h2 ) + hex( h3 );
        };
    }() )
});

}() );


// -------------------------------------------------------------------------- \\
// File: ComputedProps.js                                                     \\
// Module: Foundation                                                         \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

/**
    Module: Foundation

    The Foundation module provides the basic objects and mixins for key-value
    coding and observation as well as bindings and a run loop.
*/

var slice = Array.prototype.slice,
    meta = NS.meta;

var makeComputedDidChange = function ( key ) {
    return function () {
        this.computedPropertyDidChange( key );
    };
};

var setupComputed = function ( metadata, key, obj ) {
    var dependencies = this.dependencies,
        dependents = metadata.dependents,
        l, valueThisKeyDependsOn, method, pathObservers, methodObservers;

    if ( !metadata.hasOwnProperty( 'dependents' ) ) {
        dependents = metadata.dependents = NS.clone( dependents );
        metadata.allDependents = {};
    }
    l = dependencies.length;
    while ( l-- ) {
        valueThisKeyDependsOn = dependencies[l];
        if ( valueThisKeyDependsOn.indexOf( '.' ) === -1 ) {
            ( dependents[ valueThisKeyDependsOn ] ||
                ( dependents[ valueThisKeyDependsOn ] = [] ) ).push( key );
        } else {
            if ( !method ) {
                method = '__' + key + 'DidChange__';
                metadata.inits.Observers =
                    ( metadata.inits.Observers || 0 ) + 1;
            }
            if ( !obj[ method ] ) {
                obj[ method ] = makeComputedDidChange( key );
            }
            if ( !pathObservers ) {
                pathObservers = metadata.pathObservers;
                if ( !metadata.hasOwnProperty( 'pathObservers' ) ) {
                    pathObservers =
                        metadata.pathObservers = Object.create( pathObservers );
                }
                methodObservers = pathObservers[ method ];
                if ( !methodObservers ) {
                    methodObservers = pathObservers[ method ] = [];
                } else if ( !pathObservers.hasOwnProperty( method ) ) {
                    methodObservers =
                        pathObservers[ method ] = methodObservers.slice();
                }
            }
            methodObservers.push( valueThisKeyDependsOn );
        }
    }
};

var teardownComputed = function ( metadata, key ) {
    var dependencies = this.dependencies,
        dependents = metadata.dependents,
        l, valueThisKeyDependsOn, method, pathObservers, methodObservers;

    if ( !metadata.hasOwnProperty( 'dependents' ) ) {
        dependents = metadata.dependents = NS.clone( dependents );
        metadata.allDependents = {};
    }
    l = dependencies.length;
    while ( l-- ) {
        valueThisKeyDependsOn = dependencies[l];
        if ( valueThisKeyDependsOn.indexOf( '.' ) === -1 ) {
            dependents[ valueThisKeyDependsOn ].erase( key );
        } else {
            if ( !method ) {
                method = '__' + key + 'DidChange__';
                metadata.inits.Observers -= 1;
            }
            if ( !pathObservers ) {
                pathObservers = metadata.pathObservers;
                if ( !metadata.hasOwnProperty( 'pathObservers' ) ) {
                    pathObservers =
                        metadata.pathObservers = Object.create( pathObservers );
                }
                methodObservers = pathObservers[ method ];
                if ( !pathObservers.hasOwnProperty( method ) ) {
                    methodObservers =
                        pathObservers[ method ] = methodObservers.slice();
                }
            }
            methodObservers.erase( valueThisKeyDependsOn );
        }
    }
};

Function.implement({
    /**
        Method: Function#property

        Marks a function as a property getter/setter. If a call to
        <O.ComputedProps#get> or <O.ComputedProps#set> is made and the
        current value of the property is this method, the method will be called
        rather than just returned/overwritten itself.

        Normally, properties will only be dependent on other properties on the
        same object. You may also specify paths though, e.g. 'obj.obj2.prop' and
        this will also work, however if you do this the object (and all other
        objects in the path) *MUST* also include the <O.ObservableProps> mixin.

        Parameters:
            var_args - {...String} All arguments are treated as the names of
                       properties this value depends on; if any of these are
                       changed, the cached value for this property will be
                       invalidated.

        Returns:
            {Function} Returns self.
    */
    property: function () {
        this.isProperty = true;
        if ( arguments.length ) {
            this.dependencies = slice.call( arguments );
            this.__setupProperty__ = setupComputed;
            this.__teardownProperty__ = teardownComputed;
        }
        return this;
    },

    /**
        Method: Function#nocache

        Marks a getter method such that its value is not cached.

        Returns:
            {Function} Returns self.
    */
    nocache: function () {
        this.isVolatile = true;
        return this;
    },

    /**
        Method: Function#doNotNotify

        Marks a computed property so that when it is set,
        <O.ComputedProps#propertyDidChange> is not automatically called.

        Returns:
            {Function} Returns self.
    */
    doNotNotify: function () {
        this.isSilent = true;
        return this;
    }
});

/**
    Function: O.getFromPath

    Follows a path string (e.g. 'mailbox.messages.howMany') to retrieve the
    final object/value from a root object. At each stage of the path, if the current object supports a 'get' function, that will be used to retrieve the
    next stage, otherwise it will just be read directly as a property.

    If the full path cannot be followed, `undefined` will be returned.

    Parameters:
        root - {Object} The root object the path is relative to.
        path - {String} The path to retrieve the value from.

    Returns:
        {*} Returns the value at the end of the path.
*/
var isNum = /^\d+$/;
var getFromPath = NS.getFromPath = function ( root, path ) {
    var currentPosition = 0,
        pathLength = path.length,
        nextDot,
        key;
    while ( currentPosition < pathLength ) {
        if ( !root ) {
            return undefined;
        }
        nextDot = path.indexOf( '.', currentPosition );
        if ( nextDot === -1 ) { nextDot = pathLength; }
        key = path.slice( currentPosition, nextDot );
        root = root.getObjectAt && isNum.test( key ) ?
            root.getObjectAt( +key ) :
            root.get ?
                root.get( key ) :
                root[ key ];
        currentPosition = nextDot + 1;
    }
    return root;
};

/**
    Mixin: O.ComputedProps

    The ComputedProps mixin provides a generic get/set method for accessing
    and modifying properties. Support is also provided for getter/setter
    methods: if the property being accessed is a function marked by a call to
    <Function#property>, the function will be called and the result returned
    rather than just the function itself being returned. If the set function is
    called the value will be provided as the sole argument to the function; this
    will be undefined otherwise. Any changes made to public properties not using
    the set method must call the propertyDidChange method after the change to
    keep the cache consistent and possibly notify observers in overriden
    versions of this method.
*/

/**
    Function (private): O.ComputedProps-computeDependentKeys

    Finds all keys which have a dependency on the given key (note
    this is not just direct dependencies, but could be via intermediate
    properties).

    Parameters:
        cache   - {Object} An object mapping property names to the keys that are
                  directly dependent on them.
        key     - {String} The name of the property for which we are finding the
                  dependent keys.
        results - {String[]} This array will be populated with the
                  dependent keys. Non-recursive calls to this function should
                  supply an empty array here.

    Returns:
        {String[]} The results array.
*/
var computeDependentKeys = function ( cache, key, results ) {
    var dependents = cache[ key ];
    if ( dependents ) {
        var l = dependents.length;
        while ( l-- ) {
            var dependentKey = dependents[l];
            // May be multiple ways to get to this dependency.
            if ( results.indexOf( dependentKey ) === -1 ) {
                results.push( dependentKey );
                computeDependentKeys( cache, dependentKey, results );
            }
        }
    }
    return results;
};

NS.ComputedProps = {
    /**
        Method: O.ComputedProps#propertiesDependentOnKey

        Returns an array of the name of all computed properties
        which depend on the given key.

        Parameters:
            key - {String} The name of the key to fetch the dependents of.

        Returns:
            {Array} Returns the list of dependents (may be empty).
    */
    propertiesDependentOnKey: function ( key ) {
        var metadata = meta( this );
        return metadata.allDependents[ key ] ||
            ( metadata.allDependents[ key ] =
                computeDependentKeys( metadata.dependents, key, [] ) );
    },

    /**
        Method: O.ComputedProps#propertyDidChange

        Invalidates any cached values depending on the property.

        Parameters:
            key      - {String} The name of the property which has changed.
            oldValue - {*} (optional) The old value of the property.
            newValue - {*} (optional) The new value of the property.

        Returns:
            {O.ComputedProps} Returns self.
    */
    propertyDidChange: function ( key/*, oldValue, newValue*/ ) {
        var dependents = this.propertiesDependentOnKey( key ),
            l = dependents.length,
            cache = meta( this ).cache;
        while ( l-- ) {
            delete cache[ dependents[l] ];
        }
        return this;
    },

    /**
        Method: O.ComputedProps#computedPropertyDidChange

        Invalidates the cached value for a property then calls
        propertyDidChange.

        Parameters:
            key - {String} The name of the computed property which has changed.

        Returns:
            {O.ComputedProps} Returns self.
    */
    computedPropertyDidChange: function ( key ) {
        var cache = meta( this ).cache,
            oldValue = cache[ key ];
        delete cache[ key ];
        return this.propertyDidChange( key, oldValue );
    },

    /**
        Method: O.ComputedProps#clearPropertyCache

        Deletes the cache of computed property values.

        Parameters:
            key - {String} The name of the property to fetch.

        Returns:
            {O.ComputedProps} Returns self.
    */
    clearPropertyCache: function () {
        meta( this ).cache = {};
        return this;
    },

    /**
        Method: O.ComputedProps#set

        Sets the value of the named property on this object to the value given.
        If that property is actually a computed property, the new value is
        passed as an argument to that method. This will automatically call
        `propertyDidChange()` to invalidate cached values that depend on this
        property (and notify observers about the change in the case of
        <O.ObservableProps> objects).

        Parameters:
            key   - {String} The name of the property to set.
            value - {*} The new value of the property.

        Returns:
            {O.ComputedProps} Returns self.
    */
    set: function ( key, value ) {
        var oldValue = this[ key ],
            silent, cache;
        if ( oldValue && oldValue.isProperty ) {
            silent = !!oldValue.isSilent;
            value = oldValue.call( this, value, key );
            if ( !oldValue.isVolatile ) {
                cache = meta( this ).cache;
                oldValue = cache[ key ];
                cache[ key ] = value;
            } else {
                oldValue = undefined;
            }
        }
        else {
            // No point in notifying of a change if it hasn't really happened.
            silent = ( oldValue === value );
            this[ key ] = value;
        }
        return silent ? this : this.propertyDidChange( key, oldValue, value );
    },

    /**
        Method: O.ComputedProps#get

        Gets the value of the named property on this object. If there is an
        accessor function for this property it will call that rather than just
        returning the function. Values will be cached for efficient subsequent
        retrieval unless the accessor function is marked volatile.

        Parameters:
            key - {String} The name of the property to fetch.

        Returns:
            {*} The value of the property.
    */
    get: function ( key ) {
        var value = this[ key ],
            cache;
        if ( value && value.isProperty ) {
            if ( value.isVolatile ) {
                return value.call( this, undefined, key );
            }
            cache = meta( this ).cache;
            return ( key in cache ) ? cache[ key ] :
                ( cache[ key ] = value.call( this, undefined, key ) );
        }
        return value;
    },

    /**
        Method: O.ComputedProps#getFromPath

        Gets the value at the given path string relative to the object on which
        the method was called.

        Parameters:
            path - {String} The path (e.g. 'widget.view.height');

        Returns:
            {*} The value at that path relative to this object.
    */
    getFromPath: function ( path ) {
        return getFromPath( this, path );
    },

    /**
        Method: O.ComputedProps#increment

        Adds the value of the delta argument to the value stored in the property
        with the given key.

        Parameters:
            key   - {String} The name of the numerical property.
            delta - {Number} The amount to add to the current value.

        Returns:
            {O.ComputedProps} Returns self.
    */
    increment: function ( key, delta ) {
        return this.set( key, this.get( key ) + delta );
    },

    /**
        Method: O.ComputedProps#toggle

        Sets the value of the given key to the boolean negation of its previous
        value.

        Parameters:
            key - {String} The name of the property to toggle.

        Returns:
            {O.ComputedProps} Returns self.
    */
    toggle: function ( key ) {
        return this.set( key, !this.get( key ) );
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Binding.js                                                           \\
// Module: Foundation                                                         \\
// Requires: Core, ComputedProps.js                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global Element */

( function ( NS, Element, undefined ) {

/**
    Class: O.Binding

    Includes: O.ComputedProps

    Bindings keep a property on one object in sync with a property on another.
    This may be a two way link, so a change on either updates the other, or it
    may only flow data in one direction. A transform may be applied to the data
    between instances.

    To use, create a new instance then call <O.Binding#from>, <O.Binding#to> and
    <O.Binding#connect>. Connection will normally be handled by the
    <O.BoundProps> class rather than directly.
*/

/**
    Method (private): O.Binding-_resolveRootAndPath

    When created, a binding may need to reference a path on an object that does
    not yet exist (it will be created later in the run loop). To allow this, a
    section of the path may be defined as 'static', that is to say it is
    resolved only once; at initialisation time. Any changes along this path;
    only changes starting from the final static object will be observed.

    A static portion is signified by using a `*` as a divider instead of a `.`.
    The section before the '*' is taken to be static. If no '*' is present, the
    entire path is taken to be dynamic. For example, if the path is
    `static.path*dynamic.path`, at initialisation time, the `path`
    property of the `static` property of the root object will be found. After
    initialisation, any changes to the 'dynamic' property on this object, or
    the 'path' property on that object will trigger the binding.

    The results are set directly on the binding object passed as the first
    argument, with names direction + 'Object'/'Path'.

    Parameters:
        binding   - {O.Binding} The binding to resolve paths for.
        direction - {String} Either 'to' or 'from'.
        root      - {Object} The object to treat as root.
        path      - {String} The path string.
*/
var _resolveRootAndPath = function ( binding, direction, root, path ) {
    var beginObservablePath = path.lastIndexOf( '*' ) + 1,
        observablePath = path.slice( beginObservablePath ),
        staticPath = beginObservablePath ?
            path.slice( 0, beginObservablePath - 1 ) : '',
        lastDot = observablePath.lastIndexOf( '.' );

    binding[ direction + 'Object' ] =
        staticPath ? NS.getFromPath( root, staticPath ) : root;
    binding[ direction + 'Path' ] = observablePath;
    binding[ direction + 'PathBeforeKey' ] =
        ( lastDot === -1 ) ? '' : observablePath.slice( 0, lastDot );
    binding[ direction + 'Key' ] = observablePath.slice( lastDot + 1 );
};

var isNum = /^\d+$/;

/**
    Method (private): O.Binding-identity

    Returns the first argument. This is the default transform (has no effect).

    Parameters:
        v - {*} The value.

    Returns:
        {*} The value v.
*/
var identity = function ( v ) { return v; };

var Binding = NS.Class({

    __setupProperty__: function ( metadata, key ) {
        metadata.bindings[ key ] = this;
        metadata.inits.Bindings = ( metadata.inits.Bindings || 0 ) + 1;
    },
    __teardownProperty__: function ( metadata, key ) {
        metadata.bindings[ key ] = null;
        metadata.inits.Bindings -= 1;
    },

    /**
        Property: O.Binding#isConnected
        Type: Boolean

        Is the instance currently observing for changes?
        This property is READ ONLY.
    */

    /**
        Property: O.Binding#isNotInSync
        Type: Boolean

        Has the data changed on the from object (or the 'to' object if two-way)?
        This property is READ ONLY.
    */

    /**
        Property: O.Binding#isSuspended
        Type: Boolean

        Should the binding stop propagating changes? This property is READ ONLY.
    */

    /**
        Property: O.Binding#willSyncForward
        Type: Boolean

        The direction to sync at the next sync. True if syncing from the 'from'
        object to the 'to' object, false if it's going to do the reverse.
    */

    /**
        Property: O.Binding#isTwoWay
        Type: Boolean
        Default: false

        Are changes just propagated from the 'from' object to the 'to' object,
        or are they also sent the other way?
    */

    /**
        Property: O.Binding#queue
        Type: String
        Default: 'bindings'

        During which queue in the run loop should the binding sync?
    */


    /**
        Constructor: O.Binding

        Parameters:
            mixin - {Object} (optional). Can set isTwoWay or the transform to
                    use on the binding.
    */
    init: function ( mixin ) {
        this.isConnected = false;
        this.isSuspended = true;
        this.isNotInSync = true;
        this.willSyncForward = true;

        this._fromPath = null;
        this._fromRoot = null;
        this._toPath = null;
        this._toRoot = null;

        this.fromObject = null;
        this.fromPath = '';
        this.fromPathBeforeKey = '';
        this.fromKey = '';

        this.toObject = null;
        this.toPath = '';
        this.toPathBeforeKey = '';
        this.toKey = '';

        this.isTwoWay = false;
        this.transform = identity;
        this.queue = 'bindings';

        for ( var key in mixin ) {
            this[ key ] = mixin[ key ];
        }
    },

    /**
        Method: O.Binding#destroy

        Disconnects binding and prevents any further value syncs.
    */
    destroy: function () {
        this.disconnect();
        // Ignore any remaining queued connect() calls.
        this.isConnected = true;
    },

    /**
        Method: O.Binding#from

        Sets the path and object to observe for changes. This method has no
        effect if it is called after the object is connected.

        Parameters:
            root - {Object} (optional) The object the static path is resolved
                   against, will be the "to" root if not supplied.
            path - {String} Any path before a *' is resolved at connection time
                   and then remains static. Path components after this are
                   treated as a dynamic path to watch for changes. If there is
                   no '*' present in the string, the entire string is taken as a
                   dynamic path.

        Returns:
            {O.Binding} Returns self.
    */
    from: function ( root, path ) {
        var rootIsPath = ( typeof root === 'string' );
        this._fromRoot = rootIsPath ? path : root;
        this._fromPath = rootIsPath ? root : path;
        return this;
    },

    /**
        Method: O.Binding#to

        Sets the path and object to propagate changes to. This method has no
        effect if it is called after the object is connected.

        Parameters:
            root - {Object} (optional) The object the static path is resolved
                   against, will be the "from" root if not supplied.
            path - {String} Any path before a *' is resolved at connection time
                   and then remains static. Path components after this are
                   treated as a dynamic path to watch for changes. If there is
                   no '*' present in the string, the entire string is taken as a
                   dynamic path.

        Returns:
            {O.Binding} Returns self.
    */
    to: function ( root, path ) {
        var rootIsPath = ( typeof root === 'string' );
        this._toRoot = rootIsPath ? path : root;
        this._toPath = rootIsPath ? root : path;
        return this;
    },

    // ------------

    /**
        Property: O.Binding#fromObject
        Type: Object

        The static object the observed path begins from.
    */

    /**
        Property: O.Binding#fromPath
        Type: String

        The dynamic path to observe on the from object.
    */

    /**
        Property: O.Binding#fromKey
        Type: String

        The final component of the fromPath (the property name on the final
        object).
    */

    /**
        Property: O.Binding#fromPathBeforeKey
        Type: String

        The dynamic 'from' path component before the final key.
    */

    /**
        Property: O.Binding#toObject
        Type: Object

        The static object from which the object-to-update path is resolved.
    */

    /**
        Property: O.Binding#toPath
        Type: String

        The dynamic path to follow on the to object.
    */

    /**
        Property: O.Binding#toKey
        Type: String

        The final component of the toPath (the property name on the final
        object).
    */

    /**
        Property: O.Binding#toPathBeforeKey
        Type: String

        The dynamic 'to' path component before the final key.
    */

    // ------------

    /**
        Property (private): O.Binding#_doNotDelayConnection
        Type: Boolean

        If the to or from object cannot be resolved, should the binding delay
        the connection until the end of the run loop?
    */
    _doNotDelayConnection: false,

    /**
        Method: O.Binding#connect

        Starts observing for changes and syncs the current value of the observed
        property on the from object with the bound property on the to object.

        Returns:
            {O.Binding} Returns self.
    */
    connect: function () {
        if ( this.isConnected ) { return this; }

        this.isSuspended = false;

        // Resolve objects:
        _resolveRootAndPath(
            this, 'from', this._fromRoot || this._toRoot, this._fromPath );
        _resolveRootAndPath(
            this, 'to', this._toRoot || this._fromRoot, this._toPath );

        var fromObject = this.fromObject,
            toObject = this.toObject;

        if ( toObject instanceof Element ) {
            this.queue = 'render';
        }

        // Occassionally we have a binding created before the objects it
        // connects are, in which case delay connecting it a bit.
        if ( !this._doNotDelayConnection && ( !fromObject || !toObject ) ) {
            this._doNotDelayConnection = true;
            NS.RunLoop.queueFn( 'before', this.connect, this );
            return this;
        }

        fromObject.addObserverForPath( this.fromPath, this, 'fromDidChange' );

        // Grab initial value:
        this.sync();

        if ( this.isTwoWay ) {
            toObject.addObserverForPath( this.toPath, this, 'toDidChange' );
        }
        this.isConnected = true;
        return this;
    },

    /**
        Method: O.Binding#disconnect

        Stops observing for changes.

        Returns:
            {O.Binding} Returns self.
    */
    disconnect: function () {
        if ( !this.isConnected ) { return this; }

        this.fromObject.removeObserverForPath(
            this.fromPath, this, 'fromDidChange' );

        if ( this.isTwoWay ) {
            this.toObject.removeObserverForPath(
                this.toPath, this, 'toDidChange' );
        }

        this.isConnected = false;
        this.isSuspended = true;
        this.isNotInSync = true;
        this.willSyncForward = true;

        return this;
    },

    /**
        Method: O.Binding#suspend

        Stop propagating changes. The instance will still note when the observed
        object changes, but will not sync this to the bound property on the to
        object until the <O.Binding#resume> method is called.

        Returns:
            {O.Binding} Returns self.
    */
    suspend: function () {
        this.isSuspended = true;
        return this;
    },

    /**
        Method: O.Binding#resume

        Restart propagating changes. Sync the to object if the observed property
        has changed.

        Returns:
            {O.Binding} Returns self.
    */
    resume: function () {
        if ( this.isSuspended && this.isConnected ) {
            this.isSuspended = false;
            this.sync();
        }
        return this;
    },

    // ------------

    /**
        Property: O.Binding#transform
        Type: Function

        A function which is applied to a value coming from one object before it
        is set on the other object.
    */

    // ------------

    /**
        Method: O.Binding#fromDidChange

        Called when the observed property on the from object changes; adds the
        binding to the queue to be synced at the end of the run loop.

        Returns:
            {O.Binding} Returns self.
    */
    fromDidChange: function () {
        return this.needsSync( true );
    },

    /**
        Method: O.Binding#toDidChange

        If the binding is two-way, this is called when the observed property on
        the to object changes; adds the binding to the queue to be synced at the
        end of the run loop.

        Returns:
            {O.Binding} Returns self.
    */
    toDidChange: function () {
        return this.needsSync( false );
    },

    /**
        Method: O.Binding#needsSync

        Adds the binding to the queue to be synced at the end of the run loop.

        Parameters:
            direction - {Boolean} True if sync needed from the "from" object to
                        the "to" object, false if the reverse.

        Returns:
            {O.Binding} Returns self.
    */
    needsSync: function ( direction ) {
        var queue = this.queue,
            inQueue = this.isNotInSync;
        this.willSyncForward = direction;
        this.isNotInSync = true;
        if ( !inQueue && !this.isSuspended ) {
            if ( queue ) {
                NS.RunLoop.queueFn( queue, this.sync, this, true );
            } else {
                this.sync();
            }
        }
        return this;
    },

    /**
        Method: O.Binding#sync

        If the observed property has changed, this method applies any transforms
        and propagates the data to the other object.

        Parameters:
            force - {Boolean} If true, sync the binding even if it hasn't
                    changed.

        Returns:
            {Boolean} Did the binding actually make a change?
    */
    sync: function ( force ) {
        if ( !force && ( !this.isNotInSync || this.isSuspended ) ) {
            return false;
        }

        this.isNotInSync = false;

        var syncForward = this.willSyncForward,
            from = syncForward ? 'from' : 'to',
            to = syncForward ? 'to' : 'from',
            pathBeforeKey = this[ to + 'PathBeforeKey' ],
            toObject = this[ to + 'Object' ],
            key, value;

        if ( pathBeforeKey ) {
            toObject = toObject.getFromPath( pathBeforeKey );
        }
        if ( !toObject ) {
            return false;
        }

        key = this[ to + 'Key' ];
        value = this.transform.call( this,
            this[ from + 'Object' ].getFromPath( this[ from + 'Path' ] ),
            syncForward
        );
        if ( value !== undefined ) {
            if ( isNum.test( key ) ) {
                toObject.setObjectAt( +key, value );
            } else {
                toObject.set( key, value );
            }
        }
        return true;
    }
});

NS.Binding = Binding;

/**
    Function: O.bind

    Convenience method. A shortcut for:
        new O.Binding({
            transform: transform
        }).from( root, path );

    Parameters:
        root      - {Object} (optional) The root object on the path to bind
                    from. If not specified, will be the same object that the
                    property is bound to.
        path      - {String} The path to bind from
        transform - {Function} (optional) A transform to apply.

    Returns:
        {O.Binding} The new binding.
*/
var bind = NS.bind = function ( root, path, transform ) {
    var binding = new Binding().from( root, path );
    if ( transform ) {
        binding.transform = transform;
    }
    return binding;
};

/**
    Function: O.bindTwoWay

    Convenience method. A shortcut for:
        new O.Binding({
            isTwoWay: true,
            transform: transform
        }).from( root, path );

    Parameters:
        root      - {Object} (optional) The root object on the path to bind
                    from. If not specified, will be the same object that the
                    property is bound to.
        path      - {String} The path to bind from
        transform - {Function} (optional) A transform to apply.

    Returns:
        {O.Binding} The new binding.
*/
NS.bindTwoWay = function ( root, path, transform ) {
    var binding = bind( root, path, transform );
    binding.isTwoWay = true;
    return binding;
};

}( O, typeof Element !== undefined ? Element : function () {} ) );


// -------------------------------------------------------------------------- \\
// File: BoundProps.js                                                        \\
// Module: Foundation                                                         \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var meta = NS.meta;
var bindingKey = '__binding__';

/**
    Mixin: O.BoundProps

    The BoundProps mixin provides support for initialising bound properties
    inherited from the prototype, and for suspending/resuming bindings on the
    object.
*/
NS.BoundProps = {
    /**
        Method: O.BoundProps#initBindings

        Initialises bound properties. Creates a new Binding object if the
        binding is inherited, then connects it to the appropriate key and does
        an initial sync. You should never call this directly, but rather iterate
        through the keys of `O.meta( this ).inits`, calling
        `this[ 'init' + key ]()` for all keys which map to a truthy value.

        Returns:
            {O.BoundProps} Returns self.
    */
    initBindings: function () {
        var bindings = meta( this ).bindings,
            key, binding;
        for ( key in bindings ) {
            // Guard in case a previously bound property has been overridden in
            // a subclass by a non-bound value.
            if ( binding = bindings[ key ] ) {
                if ( !bindings.hasOwnProperty( key ) ) {
                    binding = bindings[ key ] = Object.create( binding );
                }
                // Set it to undefined. If the initial value to be synced
                // is undefined, nothing will be synced, but we don't want to
                // leave the Binding object itself as the value; instead we want
                // the value to be undefined.
                this[ key ] = undefined;
                binding.to( key, this ).connect();
            }
        }
        return this;
    },

    /**
        Method: O.BoundProps#destroyBindings

        Disconnect and destroy all bindings connected to this object. You should
        never call this directly, but rather iterate through the keys of
        `O.meta( this ).inits`, calling `this[ 'destroy' + key ]()` for all keys
        which map to a truthy value.

        Returns:
            {O.BoundProps} Returns self.
    */
    destroyBindings: function () {
        var bindings = meta( this ).bindings,
            key, binding;
        for ( key in bindings ) {
            // Guard in case a previously bound property has been overridden in
            // a subclass by a non-bound value.
            if ( binding = bindings[ key ] ) {
                binding.destroy();
            }
        }
        return this;
    },

    /**
        Method: O.BoundProps#registerBinding

        Call this whenever you add a binding to an object after initialisation,
        otherwise suspend/remove/destroy will not work correctly.

        Returns:
            {O.BoundProps} Returns self.
    */
    registerBinding: function ( binding ) {
        meta( this ).bindings[ bindingKey + NS.guid( binding ) ] = binding;
        return this;
    },

    /**
        Method: O.BoundProps#deregisterBinding

        Call this if you destroy a binding to this object before the object
        itself is destroyed.

        Returns:
            {O.BoundProps} Returns self.
    */
    deregisterBinding: function ( binding ) {
        var bindings = meta( this ).bindings,
            key = Object.keyOf( bindings, binding );
        delete bindings[ key ];
        return this;
    },

    /**
        Method: O.BoundProps#suspendBindings

        Suspend all bindings to the object. This means that any bindings to the
        object will still note if there is a change, but will not sync that
        change until the binding is resumed.

        Returns:
            {O.BoundProps} Returns self.
    */
    suspendBindings: function () {
        var bindings = meta( this ).bindings,
            key, binding;
        for ( key in bindings ) {
            if ( binding = bindings[ key ] ) {
                binding.suspend();
            }
        }
        return this;
    },

    /**
        Method: O.BoundProps#resumeBindings

        Resume (and sync if necessary) all bindings to the object.

        Returns:
            {O.BoundProps} Returns self.
    */
    resumeBindings:  function () {
        var bindings = meta( this ).bindings,
            key, binding;
        for ( key in bindings ) {
            if ( binding = bindings[ key ] ) {
                binding.resume();
            }
        }
        return this;
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Enumerable.js                                                        \\
// Module: Foundation                                                         \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var defaultComparator = function ( a, b ) {
    return a < b ? -1 : a > b ? 1 : 0;
};
var createCallback = function ( callback, bind ) {
    if ( !bind ) {
        return callback;
    }
    return function ( value, index, enumerable ) {
        return callback.call( bind, value, index, enumerable );
    };
};

/**
    Mixin: O.Enumerable

    The Enumerable mixin adds a number of iteration and accessor methods to any
    class with a 'getObjectAt' method that supports numerical values and a 'get'
    method that supports 'length'.

    The native Array type also implements O.Enumerable.
*/
var Enumerable = {

    // :: Accessor methods =====================================================

    /**
        Method: O.Enumerable#first

        Returns:
            {*} The first item in the enumerable.
    */
    first: function () {
        return this.getObjectAt( 0 );
    },

    /**
        Method: O.Enumerable#last

        Returns:
            {*} The last item in the enumerable.
    */
    last: function () {
        return this.getObjectAt( this.get( 'length' ) - 1 );
    },

    /**
        Method: O.Enumerable#indexOf

        Returns the index in the enumerable of the first occurrence of an item.

        Parameters:
            item - {*} The item to search for.
            from - {Number} (optional) The index to start searching from.

        Returns:
            {Number} The (first) index in the array of the item or -1 if not
            found.
    */
    indexOf: function ( item, from ) {
        var l = this.get( 'length' );
        for ( from = ( from < 0 ) ?
                Math.max( 0, l + from ) : ( from || 0 ); from < l; from += 1 ){
            if ( this.getObjectAt( from ) === item ) {
                return from;
            }
        }
        return -1;
    },

    /**
        Method: O.Enumerable#lastIndexOf

        Returns the index in the enumerable of the last occurrence of an item.

        Parameters:
            item - {*} The item to search for.
            from - {Number} (optional) The index to start searching from.

        Returns:
            {Number} The (last) index in the array of the item or -1 if not
            found.
    */
    lastIndexOf: function ( item, from ) {
        var l = this.get( 'length' );
        for ( from = ( from < 0 ) ? ( l + from ) : ( from || l - 1 );
                from >= 0 ; from -= 1 ){
            if ( this.getObjectAt( from ) === item ) {
                return from;
            }
        }
        return -1;
    },

    /**
        Method: Array#binarySearch

        *Presumes the enumerable is sorted.*

        Does a binary search on the array to find the index for the given value,
        or if not in the array, then the index at which it should be inserted to
        maintain the ordering of the array.

        Parameters:
            value      - {*} The value to search for in the array
            comparator - {Function} (optional). A comparator function. If not
                         supplied, the comparison will be made simply by the `<`
                         infix comparator.

        Returns:
            {Number} The index to place the value in the sorted array.
    */
    binarySearch: function ( value, comparator ) {
        var lower = 0,
            upper = this.get( 'length' ),
            middle, candidate;
        if ( !comparator ) { comparator = defaultComparator; }
        while ( lower < upper ) {
            middle = ( lower + upper ) >> 1;
            candidate = this.getObjectAt( middle );
            if ( comparator( candidate, value ) < 0 ) {
                lower = middle + 1;
            } else {
                upper = middle;
            }
        }
        return lower;
    },

    /**
        Method: O.Enumerable#contains

        Tests whether the item is in the enumerable.

        Parameters:
            item - {*} The item to check.

        Returns:
            {Boolean} True if the item is present.
    */
    contains: function ( item ) {
        return this.indexOf( item ) > -1;
    },

    /**
        Method: O.Enumerable#find

        Tests each item in the enumerable with a given function and returns the
        first item for which the function returned a truthy value. The function
        will be supplied with 3 parameters when called:

        1. The value.
        2. The index of the value in the enumerable.
        3. The enumerable itself.

        Parameters:
            fn   - {Function} The function to test each value with.
            bind - {Object} (optional) The object to bind the 'this' parameter
                   to on each call of the function.

        Returns:
            {*} The object found, or null if none found.
    */
    find: function ( fn, bind ) {
        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            var value = this.getObjectAt( i );
            if ( callback( value, i, this ) ) {
                return value;
            }
        }
        return null;
    },

    // :: Iteration methods ====================================================

    /**
        Method: O.Enumerable#forEach

        Applies the given function to each item in the enumerable. The function
        will be supplied with 3 parameters when called:

        1. The value.
        2. The index of the value in the enumerable.
        3. The enumerable itself.

        Parameters:
            fn   - {Function} The function to apply to each value.
            bind - {Object} (optional) The object to bind the 'this' parameter
                   to on each call of the function.

        Returns:
            {O.Enumerable} Returns self.
    */
    forEach: function ( fn, bind ) {
        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            callback( this.getObjectAt( i ), i, this );
        }
        return this;
    },

    /**
        Method: O.Enumerable#filter

        Tests each item in the enumerable with a given function and returns an
        array of all items for which the function returned a truthy value. The
        function will be supplied with 3 parameters when called:

        1. The value.
        2. The index of the value in the enumerable.
        3. The enumerable itself.

        Parameters:
            fn   - {Function} The function to test each value with.
            bind - {Object} (optional) The object to bind the 'this' parameter
                   to on each call of the function.

        Returns:
            {Array} The items which were accepted by the function.
    */
    filter: function ( fn, bind ) {
        var callback = createCallback( fn, bind ),
            results = [];
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            var value = this.getObjectAt( i );
            if ( callback( value, i, this ) ) {
                results.push( value );
            }
        }
        return results;
    },

    /**
        Method: O.Enumerable#map

        Applies the given function to each item in the enumerable and returns an
        array of all the results. The function will be supplied with 3
        parameters when called:

        1. The value.
        2. The index of the value in the enumerable.
        3. The enumerable itself.

        Parameters:
            fn   - {Function} The function to apply to each value.
            bind - {Object} (optional) The object to bind the 'this' parameter
                   to on each call of the function.

        Returns:
            {Array} The result of each function call.
    */
    map: function ( fn, bind ) {
        var callback = createCallback( fn, bind ),
            results = [];
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            results[i] = callback( this.getObjectAt( i ), i, this );
        }
        return results;
    },

    /**
        Method: O.Enumerable#reduce

        ECMAScript 5 reduce method.

        Parameters:
            fn      - {Function} The function to apply to the accumulator and
                      each item in the array.
            initial - {*} (optional) The initial value of the accumulator. Taken
                      to be the first value in the array if not supplied.

        Returns:
            {*} The reduced value.
    */
    reduce: function ( fn, initial ) {
        var i = 0,
            l = this.get( 'length' ),
            acc;

        if ( !l && arguments.length === 1 ) {
            throw new TypeError();
        }

        if ( arguments.length >= 2 ) {
            acc = initial;
        } else {
            acc = this.getObjectAt( 0 );
            i = 1;
        }
        for ( ; i < l; i += 1 ) {
            acc = fn( acc, this.getObjectAt( i ), i, this );
        }
        return acc;
    },

    /**
        Method: O.Enumerable#every

        Applies the given function to each item in the enumerable until it finds
        one for which the function returns a falsy value. The function will be
        supplied with 3 parameters when called:

        1. The value.
        2. The index of the value in the enumerable.
        3. The enumerable itself.

        Parameters:
            fn   - {Function} The function to apply to test the values with.
            bind - {Object} (optional) The object to bind the 'this' parameter
                   to on each call of the function.

        Returns:
            {Boolean} Were all items accepted by the function?
    */
    every: function ( fn, bind ) {
        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            if ( !callback( this.getObjectAt( i ), i, this ) ) {
                return false;
            }
        }
        return true;
    },

    /**
        Method: O.Enumerable#some

        Applies the given function to each item in the enumerable until it finds
        one for which the function returns a truthy value. The function will be
        supplied with 3 parameters when called:

        1. The value.
        2. The index of the value in the enumerable.
        3. The enumerable itself.

        Parameters:
            fn   - {Function} The function to apply to test the values with.
            bind - {Object} (optional) The object to bind the 'this' parameter
                   to on each call of the function.

        Returns:
            {Boolean} Did the function accept at least one item?
    */
    some: function ( fn, bind ) {
        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            if ( callback( this.getObjectAt( i ), i, this ) ) {
                return true;
            }
        }
        return false;
    }
};

Array.implement( Enumerable );

NS.Enumerable = Enumerable;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: EventTarget.js                                                       \\
// Module: Foundation                                                         \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var meta = NS.meta,
    slice = Array.prototype.slice,
    eventPrefix = '__event__',
    toString = Object.prototype.toString;

Function.implement({
    /**
        Method: Function#on

        Defines the list of events this method is interested in. Whenever one of
        these events is triggered on the object to which this method belongs,
        the method will automatically be called.

        Parameters:
            var_args - {...String} All arguments are treated as the names of
                       events this method should be triggered by.

        Returns:
            {Function} Returns self.
     */
    on: function () {
        return this.observes.apply( this,
            slice.call( arguments ).map( function ( type ) {
                return eventPrefix + type;
            })
        );
    }
});

/**
    Class: O.Event

    Represents a synthetic event.
*/
var Event = NS.Class({

    /**
        Constructor: O.Event

        Parameters:
            type   - {String} The event type.
            target - {Object} The target on which the event is to fire.
            mixin  - {Object} (optional) Any further properties to add to the
                     event.
    */
    init: function ( type, target, mixin ) {
        this.type = type;
        this.target = target;
        this.defaultPrevented = false;
        this.propagationStopped = false;
        NS.extend( this, mixin );
    },

    /**
        Method: O.Event#preventDefault

        Prevent the default action for this event (if any).

        Returns:
            {O.Event} Returns self.
    */
    preventDefault: function () {
        this.defaultPrevented = true;
        return this;
    },

    /**
        Method: O.Event#stopPropagation

        Stop bubbling the event up to the next target.

        Returns:
            {O.Event} Returns self.
    */
    stopPropagation: function () {
        this.propagationStopped = true;
        return this;
    }
});

NS.Event = Event;

/**
    Mixin: O.EventTarget

    The EventTarget mixin allows you to add custom event support to any other
    class complete with support for bubbling. Simply add a `Mixin:
    O.EventTarget` property to your class. Then you can fire an event at any
    time by calling `this.fire('eventName')`. If you add a target to support
    bubbling, it is recommended you add a prefix to the name of your events, to
    distinguish them from those of other classes, e.g. the IO class fires
    `io:eventName` events.
*/
NS.EventTarget = {

    /**
        Property: O.EventTarget#nextEventTarget
        Type: (O.EventTarget|null)

        Pointer to the next object in the event bubbling chain.
    */
    nextEventTarget: null,

    /**
        Method: O.EventTarget#on

        Add a function to be called whenever an event of a particular type is
        fired.

        Parameters:
            type   - {String} The name of the event to subscribe to.
            obj    - {(Function|Object)} The function to be called when the
                     event fires, or alternatively supply an object and in the
                     third parameter give the name of the method to be called on
                     it.
            method - {String} (optional) The name of the callback method to be
                     called on obj. Ignored if a function is passed for the 2nd
                     parameter.

        Returns:
            {O.EventTarget} Returns self.
    */
    on: function ( type, obj, method ) {
        if ( !( obj instanceof Function ) ) {
            obj = { object: obj, method: method };
        }
        type = eventPrefix + type;

        var observers = meta( this ).observers,
            handlers = observers[ type ];
        if ( !observers.hasOwnProperty( type ) ) {
            handlers = observers[ type ] = handlers ?
                handlers.slice() : [];
        }
        handlers.push( obj );
        return this;
    },

    /**
        Method: O.EventTarget#once

        Add a function to be called the next time an event of a particular type
        is fired, but not for subsequent firings.

        Parameters:
            type - {String} The name of the event to subscribe to.
            fn   - {Function} The function to be called when the event fires.

        Returns:
            {O.EventTarget} Returns self.
    */
    once: function ( type, fn ) {
        var once = function ( event ) {
            fn.call( this, event );
            this.off( type, once );
        };
        this.on( type, once );
        return this;
    },

    /**
        Method: O.EventTarget#fire

        Fires an event, causing all subscribed functions to be called with an
        event object as the single parameter and the scope bound to the object
        on which they subscribed to the event. In the case of subscribed
        object/method name pairs, the scope will remain the object on which the
        method is called.

        The event object contains the properties supplied in the details
        parameter and also a type attribute, with the type of the event, a
        target attribute, referencing the object on which the event was actually
        fired, a preventDefault function, which stops the default function
        firing if supplied, and a stopPropagation function, which prevents the
        event bubbling any further.

        Parameters:
            type  - {String} The name of the event being fired.
            event - {Event|O.Event|Object} (optional) An event object or object
                    of values to be added to the event object.

        Returns:
            {O.EventTarget} Returns self.
    */
    fire: function ( type, event ) {
        var target = this,
            typeKey = eventPrefix + type,
            handler, handlers, length;

        if ( !event || !( event instanceof Event ) ) {
            if ( event && /Event\]$/.test( toString.call( event ) ) ) {
                event.stopPropagation = function () {
                    this.propagationStopped = true;
                    return this;
                };
            } else {
                event = new Event( type, target, event );
            }
        }
        event.propagationStopped = false;

        while ( target ) {
            handlers = meta( target ).observers[ typeKey ];
            length = handlers ? handlers.length : 0;
            while ( length-- ) {
                try {
                    handler = handlers[ length ];
                    if ( handler instanceof Function ) {
                        handler.call( target, event );
                    } else {
                        ( handler.object || target )[ handler.method ]( event );
                    }
                } catch ( error ) {
                    NS.RunLoop.didError( error );
                }
            }
            // Move up the hierarchy, unless stopPropagation was called
            target =
                event.propagationStopped ?
                    null :
                target.get ?
                    target.get( 'nextEventTarget' ) :
                    target.nextEventTarget;
        }

        return this;
    },

    /**
        Method: O.EventTarget#off

        Detaches a particular event handler or all handlers for a particular
        event type. This method has no effect if the function supplied is not
        subscribed to the event type given, or no function is supplied and the
        event type given has no handlers subscribed.

        Parameters:
            type   - {String} The name of the event to detach handlers from.
            obj    - {(Function|Object)} (optional) The function to detach or
                     the obj whose method will be detached. If this argument is
                     not supplied, all handlers for the given type will be
                     removed.
            method - {String} (optional) The name of the callback method to be
                     detached. Ignored if a function is passed for the 2nd
                     parameter.

        Returns:
            {O.EventTarget} Returns self.
    */
    off: function ( type, obj, method ) {
        type = eventPrefix + type;

        var observers = meta( this ).observers,
            handlers = observers[ type ];
        if ( handlers ) {
            if ( !observers.hasOwnProperty( type ) ) {
                handlers = observers[ type ] = handlers.slice();
            }
            if ( obj ) {
                if ( !( obj instanceof Function ) ) {
                    var l = handlers.length;
                    while ( l-- ) {
                        var handler = handlers[l];
                        if ( handler.object === obj &&
                                handler.method === method ) {
                            handlers.splice( l, 1 );
                        }
                    }
                } else {
                    handlers.erase( obj );
                }
            } else {
                handlers.length = 0;
            }
        }
        return this;
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Heap.js                                                              \\
// Module: Foundation                                                         \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var Heap = NS.Class({

    init: function ( comparator ) {
        this.data = [];
        this.length = 0;
        this.comparator = comparator;
    },

    _up: function ( i ) {
        var data = this.data,
            comparator = this.comparator,
            j, node, parentNode;

        node = data[i];
        while ( i ) {
            // Get parent node
            j = ( i - 1 ) >> 1;
            parentNode = data[j];
            // If node is bigger than or equal to parent, we're done
            if ( comparator( node, parentNode ) >= 0 ) {
                break;
            }
            // Otherwise swap and continue up tree
            data[j] = node;
            data[i] = parentNode;
            i = j;
        }
        return i;
    },

    _down: function ( i ) {
        var data = this.data,
            length = this.length,
            comparator = this.comparator,
            node, j, k, childNode;

        node = data[i];
        while ( true ) {
            j = ( i << 1 ) + 1;
            k = j + 1;

            // Does it have children?
            if ( j >= length ) {
                break;
            }
            childNode = data[j];

            // Get the smaller child
            if ( k < length && comparator( childNode, data[k] ) > 0 ) {
                childNode = data[k];
                j = k;
            }

            // If node is smaller than or equal to child, we're done
            if ( comparator( node, childNode ) <= 0 ) {
                break;
            }
            // Otherwise, swap and continue down tree
            data[j] = node;
            data[i] = childNode;
            i = j;
        }

        return i;
    },

    push: function ( node ) {
        if ( node != null ) {
            var length = this.length;
            this.data[ length ] = node;
            this.length = length + 1;
            this._up( length );
        }
        return this;
    },

    pop: function () {
        var data = this.data,
            length = this.length,
            nodeToReturn;

        if ( !length ) {
            return null;
        }

        nodeToReturn = data[0];

        length -= 1;
        data[0] = data[ length ];
        data[ length ] = null;
        this.length = length;

        this._down( 0 );

        return nodeToReturn;
    },

    peek: function () {
        return this.data[0];
    },

    remove: function ( node ) {
        var data = this.data,
            length = this.length,
            i = node == null || !length ?
                -1 : data.lastIndexOf( node, length - 1 );

        // Not found
        if ( i < 0 ) {
            return this;
        }

        // Move last node to fill gap
        length -= 1;
        data[i] = data[ length ];
        data[ length ] = null;
        this.length = length;

        // Fast path: removing last-place item. Tree is already correct
        // Otherwise, we have to rebalance. Sift up, then sift down.
        if ( i !== length ) {
            this._down( this._up( i ) );
        }

        return this;
    }
});

NS.Heap = Heap;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: MutableEnumerable.js                                                 \\
// Module: Foundation                                                         \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var slice = Array.prototype.slice;

/**
    Mixin: O.MutableEnumerable

    The MutableEnumerable mixin adds a number of mutation methods to any class
    with a 'replaceObjectsAt' method and a 'get' method that supports 'length'.
    The API mirrors that of the native Array type.
*/
NS.MutableEnumerable = {

    // :: Mutation methods =====================================================

    /**
        Method: O.MutableEnumerable#push

        ECMAScript Array#push.

        Parameters:
            var_args - {...*} The items to add to the end of the array.

        Returns:
            {Number} The new length of the array.
    */
    push: function () {
        var newItems = slice.call( arguments );
        this.replaceObjectsAt( this.get( 'length' ), 0, newItems );
        return this.get( 'length' );
    },

    /**
        Method: O.MutableEnumerable#pop

        ECMAScript Array#pop.

        Returns:
            {*} The removed last value from the array.
    */
    pop: function () {
        var length = this.get( 'length' );
        return length === 0 ?
            undefined : this.replaceObjectsAt( length - 1, 1 )[0];
    },

    /**
        Method: O.MutableEnumerable#unshift

        ECMAScript Array#unshift.

        Parameters:
            var_args - {...*} The items to add to the beginning of the array.

        Returns:
            {Number} The new length of the array.
    */
    unshift: function () {
        var newItems = slice.call( arguments );
        this.replaceObjectsAt( 0, 0, newItems );
        return this.get( 'length' );
    },

    /**
        Method: O.MutableEnumerable#shift

        ECMAScript Array#shift.

        Returns:
            {*} The removed first value from the array.
    */
    shift: function () {
        return this.get( 'length' ) === 0 ?
            undefined : this.replaceObjectsAt( 0, 1 )[0];
    },

    /**
        Method: O.MutableEnumerable#splice

        ECMAScript Array#splice.

        Parameters:
            index         - {Number} The index to start removing/inserting items
                            at.
            numberRemoved - {Number} The number of items to remove.
            var_args      - {...*} The items to insert starting from position
                            index.

        Returns:
            {Array} The items removed from the array.
    */
    splice: function ( index, numberRemoved ) {
        var newItems = slice.call( arguments, 2 );
        return this.replaceObjectsAt( index, numberRemoved, newItems );
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RunLoop.js                                                           \\
// Module: Foundation                                                         \\
// Requires: Core, Heap.js                                                    \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global setTimeout, clearTimeout, setImmediate, console */

( function ( NS, win, setImmediate ) {

var requestAnimFrame =
    win.requestAnimationFrame       ||
    win.oRequestAnimationFrame      ||
    win.webkitRequestAnimationFrame ||
    win.mozRequestAnimationFrame    ||
    win.msRequestAnimationFrame     ||
    ( function () {
        var lastTime = 0;
        return function ( callback ) {
            var time = Date.now(),
                timeToNextCall = Math.max( 0, 16 - ( time - lastTime ) );
                lastTime = time;
            win.setTimeout( function () {
                callback( time + timeToNextCall );
            }, timeToNextCall );
        };
    }() );

var Timeout = function ( time, period, fn, bind ) {
    this.time = time;
    this.period = period;
    this.fn = fn;
    this.bind = bind;
};

/**
    Class: O.RunLoop

    The run loop allows data to propagate through the app in stages, preventing
    multiple changes to an object firing off the same observers several times.
    To use, wrap the entry point functions in a call to <O.RunLoop.invoke>.
*/

var RunLoop = {

    mayRedraw: false,

    /**
        Property (private): NS.RunLoop._queueOrder
        Type: String[]

        The order in which to flush the queues.
    */
    _queueOrder: [ 'before', 'bindings', 'middle', 'render', 'after' ],

    /**
        Property (private): NS.RunLoop._queues
        Type: Object

        Collection of queues. Each queue contains [fn, bind] tuples to call at
        <O.RunLoop.end>.
    */
    _queues: {
        before: [],
        bindings: [],
        middle: [],
        render: [],
        after: [],
        nextLoop: [],
        nextFrame: []
    },

    /**
        Property (private): NS.RunLoop._timeouts
        Type: O.Heap

        A priority queue of timeouts.
    */
    _timeouts: new NS.Heap( function ( a, b ) {
        return a.time - b.time;
    }),

    /**
        Property (private): NS.RunLoop._nextTimeout
        Type: Number

        Epoch time that the next browser timeout is scheduled for.
    */
    _nextTimeout: 0,

    /**
        Property (private): NS.RunLoop._timer
        Type: Number

        The browser timer id (response from setTimeout), which you need if
        you want to cancel the timeout.
    */
    _timer: null,

    /**
        Property (private): NS.RunLoop._depth
        Type: Number

        Number of calls to <O.RunLoop.invoke> currently in stack.
    */
    _depth: 0,

    /**
        Method: O.RunLoop.flushQueue

        Invokes each function in an array of [function, object] tuples, binding
        the this parameter of the function to the object, and empties the array.

        Parameters:
            queue - {String} name of the queue to flush.

        Returns:
            {Boolean} Were any functions actually invoked?
    */
    flushQueue: function ( queue ) {
        var toInvoke = this._queues[ queue ],
            l = toInvoke.length,
            i, tuple, fn, bind;

        if ( l ) {
            this._queues[ queue ] = [];

            for ( i = 0; i < l; i += 1 ) {
                tuple = toInvoke[i];
                fn = tuple[0];
                bind = tuple[1];
                try {
                    if ( bind ) {
                        fn.call( bind );
                    } else {
                        fn();
                    }
                }
                catch ( error ) {
                    RunLoop.didError( error );
                }
            }
            return true;
        }
        return false;
    },

    /**
        Method: O.RunLoop.flushAllQueues

        Calls O.RunLoop#flushQueue on each queue in the order specified in
        _queueOrder, starting at the first queue again whenever the queue
        indicates something has changed.

        Parameters:
            queue - {String} name of the queue to flush.

        Returns:
            {Boolean} Were any functions actually invoked?
    */
    flushAllQueues: function () {
        var order = this._queueOrder,
            i = 0, l = order.length;
        while ( i < l ) {
            // Render waits for next frame, except if in bg, since
            // animation frames don't fire while in the background
            // and we want to flush queues in a reasonable time, as they may
            // redraw the tab name, favicon etc.
            if ( i === 3 && !this.mayRedraw && !document.hidden ) {
                this.invokeInNextFrame( this.flushAllQueues, this );
                return;
            }
            i = this.flushQueue( order[i] ) ? 0 : i + 1;
        }
    },

    /**
        Method: O.RunLoop.queueFn

        Add a [function, object] tuple to a queue, ensuring it is not added
        again if it is already there.

        Parameters:
            queue     - {String} The name of the queue to add the tuple to.
            fn        - {Function} The function to add to the array.
            bind      - {(Object|undefined)} The object the function will be
                        bound to when called.
            allowDups - {Boolean} (optional) If not true, will search queue to
                        check this fn/bind combination is not already present.

        Returns:
            {O.RunLoop} Returns self.
    */
    queueFn: function ( queue, fn, bind, allowDups ) {
        var toInvoke = this._queues[ queue ],
            l = toInvoke.length,
            i, tuple;
        // Log error here, as the stack trace is useless inside flushQueue.
        if ( !fn ) {
            try {
                fn();
            } catch ( error ) {
                RunLoop.didError( error );
            }
        } else {
            if ( !allowDups ) {
                for ( i = 0; i < l; i += 1 ) {
                    tuple = toInvoke[i];
                    if ( tuple[0] === fn && tuple[1] === bind ) {
                        return this;
                    }
                }
            }
            toInvoke[l] = [ fn, bind ];
        }
        return this;
    },

    /**
        Method: O.RunLoop.invoke

        Invoke a function inside the run loop. Note, to pass arguments you must
        supply a bind; use `null` if you would like the global scope.

        Parameters:
            fn   - {Function} The function to invoke
            bind - {Object} (optional) The object to bind `this` to when calling
                   the function.
            args - {Array} (optional) The arguments to pass to the function.

        Returns:
            {O.RunLoop} Returns self.
    */
    invoke: function ( fn, bind, args ) {
        this._depth += 1;
        try {
            // IE8 will throw an error if args is undefined
            // when calling fn.apply for some reason.
            // Avoiding apply/call when not needed is also probably more
            // efficient.
            if ( args ) {
                fn.apply( bind, args );
            } else if ( bind ) {
                fn.call( bind );
            } else {
                fn();
            }
        } catch ( error ) {
            RunLoop.didError( error );
        }
        if ( this._depth === 1 ) {
            this.flushAllQueues();
        }
        this._depth -= 1;
        if ( !this._depth ) {
            this.processTimeouts();
        }
        return this;
    },

    /**
        Method: O.RunLoop.invokeInNextEventLoop

        Use this to invoke a function in a new browser event loop, immediately
        after this event loop has finished.

        Parameters:
            fn   - {Function} The function to invoke.
            bind - {Object} (optional) The object to make the 'this' parameter
                   when the function is invoked.

        Returns:
            {O.RunLoop} Returns self.
    */
    invokeInNextEventLoop: function ( fn, bind ) {
        var nextLoopQueue = this._queues.nextLoop;
        if ( !nextLoopQueue.length ) {
            setImmediate( nextLoop );
        }
        nextLoopQueue.push([ fn, bind ]);
        return this;
    },

    /**
        Method: O.RunLoop.invokeInNextFrame

        Use this to invoke a function just before the browser next redraws.

        Parameters:
            fn   - {Function} The function to invoke.
            bind - {Object} (optional) The object to make the 'this' parameter
                   when the function is invoked.

        Returns:
            {O.RunLoop} Returns self.
    */
    invokeInNextFrame: function ( fn, bind ) {
        var nextFrameQueue = this._queues.nextFrame;
        if ( !nextFrameQueue.length ) {
            requestAnimFrame( nextFrame );
        }
        nextFrameQueue.push([ fn, bind ]);
        return this;
    },

    /**
        Method: O.RunLoop.invokeAfterDelay

        Use this to invoke a function after a specified delay. The function will
        be called inside a new RunLoop, and optionally bound to a supplied
        object.

        Parameters:
            fn    - {Function} The function to invoke after a delay.
            delay - {Number} The delay in milliseconds.
            bind  - {Object} (optional) The object to make the 'this' parameter
                    when the function is invoked.

        Returns:
            {InvocationToken} Returns a token that can be passed to the
            <O.RunLoop.cancel> method before the function is invoked, in order
            to cancel the scheduled invocation.
    */
    invokeAfterDelay: function ( fn, delay, bind ) {
        var timeout = new Timeout( Date.now() + delay, 0, fn, bind );
        this._timeouts.push( timeout );
        this._scheduleTimeout();
        return timeout;
    },

    /**
        Method: O.RunLoop.invokePeriodically

        Use this to invoke a function periodically, with a set time between
        invocations.

        Parameters:
            fn     - {Function} The function to invoke periodically.
            period - {Number} The period in milliseconds between invocations.
            bind   - {Object} (optional) The object to make the 'this' parameter
                     when the function is invoked.

        Returns:
            {InvocationToken} Returns a token that can be passed to the
            <O.RunLoop.cancel> method to cancel all future invocations scheduled
            by this call.
    */
    invokePeriodically: function ( fn, period, bind ) {
        var timeout = new Timeout( Date.now() + period, period, fn, bind );
        this._timeouts.push( timeout );
        this._scheduleTimeout();
        return timeout;
    },

    /**
        Method (private): NS.RunLoop._scheduleTimeout

        Sets the browser timer if necessary to trigger at the time of the next
        timeout in the priority queue.
    */
    _scheduleTimeout: function () {
        var timeout = this._timeouts.peek(),
            time = timeout ? timeout.time : 0,
            delay;
        if ( time && time !== this._nextTimeout ) {
            clearTimeout( this._timer );
            delay = time - Date.now();
            if ( delay > 0 ) {
                this._timer = setTimeout( processTimeouts, time - Date.now() );
                this._nextTimeout = time;
            } else {
                this._nextTimeout = 0;
            }
        }
    },

    /**
        Method: NS.RunLoop.processTimeouts

        Invokes all functions in the timeout queue that were scheduled to
        trigger on or before "now".

        Returns:
            {O.RunLoop} Returns self.
    */
    processTimeouts: function () {
        var timeouts = this._timeouts,
            timeout, period;
        while ( timeouts.length && timeouts.peek().time <= Date.now() ) {
            timeout = timeouts.pop();
            if ( period = timeout.period ) {
                timeout.time = Date.now() + period;
                timeouts.push( timeout );
            }
            this.invoke( timeout.fn, timeout.bind );
        }
        this._scheduleTimeout();
        return this;
    },

    /**
        Method: O.RunLoop.cancel

        Use this to cancel the future invocations of functions scheduled with
        the <O.RunLoop.invokeAfterDelay> or <O.RunLoop.invokePeriodically>
        methods.

        Parameters:
            token - {InvocationToken} The InvocationToken returned by the
                    call to invokeAfterDelay or invokePeriodically that you wish
                    to cancel.

        Returns:
            {O.RunLoop} Returns self.
    */
    cancel: function ( token ) {
        this._timeouts.remove( token );
        return this;
    },

    /**
        Method: O.RunLoop.didError

        This method is invoked if an uncaught error is thrown in a run loop.
        Overwrite this method to do something more useful then just log the
        error to the console.

        Parameters:
            error - {Error} The error object.
    */
    didError: function ( error ) {
        console.log( error.name, error.message, error.stack );
    }
};

NS.RunLoop = RunLoop;

Function.implement({
    /**
        Method: Function#queue

        Parameters:
            queue - {String} The name of the queue to add calls to this function
                    to.

        Returns:
            {Function} Returns wrapper that passes calls to
            <O.RunLoop.queueFn>.
    */
    queue: function ( queue ) {
        var fn = this;
        return function () {
            RunLoop.queueFn( queue, fn, this );
            return this;
        };
    },

    /**
        Method: Function#nextLoop

        Returns:
            {Function} Returns wrapper that passes calls to
            <O.RunLoop.invokeInNextEventLoop>.
    */
    nextLoop: function () {
        var fn = this;
        return function () {
            RunLoop.invokeInNextEventLoop( fn, this );
            return this;
        };
    },

    /**
        Method: Function#nextFrame

        Returns:
            {Function} Returns wrapper that passes calls to
            <O.RunLoop.invokeInNextFrame>.
    */
    nextFrame: function () {
        var fn = this;
        return function () {
            RunLoop.invokeInNextFrame( fn, this );
            return this;
        };
    },

    /**
        Method: Function#invokeInRunLoop

        Wraps any calls to this function inside a call to <O.RunLoop.invoke>.

        Returns:
            {Function} Returns wrapped function.
    */
    invokeInRunLoop: function () {
        var fn = this;
        return function () {
            RunLoop.invoke( fn, this, arguments );
        };
    }
});

var nextLoop = RunLoop.invoke.bind( RunLoop,
    RunLoop.flushQueue, RunLoop, [ 'nextLoop' ]
);
var processTimeouts = RunLoop.processTimeouts.bind( RunLoop );

var nextFrame = function ( time ) {
    RunLoop.frameStartTime = time;
    RunLoop.mayRedraw = true;
    RunLoop.invoke( RunLoop.flushQueue, RunLoop, [ 'nextFrame' ] );
    RunLoop.mayRedraw = false;
};

}( O, window, typeof setImmediate !== 'undefined' ?
    setImmediate :
    function ( fn ) {
        return setTimeout( fn, 0 );
    }
) );


// -------------------------------------------------------------------------- \\
// File: ObservableProps.js                                                   \\
// Module: Foundation                                                         \\
// Requires: Core, RunLoop.js                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined  ) {

var meta = NS.meta;

var setupObserver = function ( metadata, method ) {
    var observes = this.observedProperties,
        observers = metadata.observers,
        l = observes.length,
        key, keyObservers, pathObservers;

    while ( l-- ) {
        key = observes[l];
        if ( key.indexOf( '.' ) === -1 ) {
            keyObservers = observers[ key ];
            if ( !observers.hasOwnProperty( key ) ) {
                keyObservers = observers[ key ] = keyObservers ?
                    keyObservers.slice() : [];
            }
            keyObservers.push({ object: null, method: method });
        } else {
            if ( !pathObservers ) {
                pathObservers = metadata.pathObservers;
                if ( !metadata.hasOwnProperty( 'pathObservers' ) ) {
                    pathObservers =
                        metadata.pathObservers = Object.create( pathObservers );
                }
                // There can't be any existing path observers for this method,
                // as we're only just adding it (and if we're overriding a
                // previous method, we should have removed all of their path
                // observers first anyway).
                pathObservers = pathObservers[ method ] = [];
                metadata.inits.Observers =
                    ( metadata.inits.Observers || 0 ) + 1;
            }
            pathObservers.push( key );
        }
    }
};

var teardownObserver = function ( metadata, method ) {
    var observes = this.observedProperties,
        observers = metadata.observers,
        l = observes.length,
        key, keyObservers, observer, j, pathObservers;

    while ( l-- ) {
        key = observes[l];
        if ( key.indexOf( '.' ) === -1 ) {
            keyObservers = observers[ key ];
            if ( !observers.hasOwnProperty( key ) ) {
                keyObservers = observers[ key ] = keyObservers.slice();
            }
            j = keyObservers.length;
            while ( j-- ) {
                observer = keyObservers[j];
                if ( observer.object === null &&
                        observer.method === method ) {
                    keyObservers.splice( j, 1 );
                    break;
                }
            }
        } else {
            if ( !pathObservers ) {
                pathObservers = metadata.pathObservers;
                if ( !metadata.hasOwnProperty( 'pathObservers' ) ) {
                    pathObservers =
                        metadata.pathObservers = Object.create( pathObservers );
                }
                // We want to remove all path observers. Can't just delete
                // though, as it may defined on the prototype object.
                pathObservers[ method ] = null;
                metadata.inits.Observers -= 1;
            }
        }
    }
};

Function.implement({
    /**
        Method: Function#observes

        Defines the list of properties (on the same object) or paths (relative
        to this object) that this method is interested in. Whenever one of these
        properties changes, the method will automatically be called.

        Parameters:
            var_args - {...String} All arguments are treated as the names of
                       properties this method should observe.

        Returns:
            {Function} Returns self.
     */
    observes: function () {
        var properties = ( this.observedProperties ||
            ( this.observedProperties = [] ) ),
            l = arguments.length;
        while ( l-- ) {
            properties.push( arguments[l] );
        }
        this.__setupProperty__ = setupObserver;
        this.__teardownProperty__ = teardownObserver;
        return this;
    }
});

/**
    Method (private): O.ObservableProps-_setupTeardownPaths

    Adds or removes path observers for methods on an object.

    Parameters:
        obj    - {Object} The object to setup/teardown path observers for.
        method - {String} Either 'addObserverForPath' or 'removeObserverForPath'
*/
var _setupTeardownPaths = function ( obj, method ) {
    var pathObservers = meta( obj ).pathObservers,
        key, paths, l;
    for ( key in pathObservers ) {
        paths = pathObservers[ key ];
        if ( paths ) {
            l = paths.length;
            while ( l-- ) {
                obj[ method ]( paths[l], obj, key );
            }
        }
    }
};

/**
    Method (private): O.ObservableProps-_notifyObserversOfKey

    Notifies any observers of a particular key and also removes old path
    observers and adds them to the new object.

    Parameters:
        that     - {O.ObservableProps} The object on which the property has
                   changed.
        metadata - {Object} The metadata for this object.
        key      - {String} The name of the property whose observers need to
                   be notified.
        oldValue - {*} The old value for the property.
        newValue - {*} The new value for the property.
*/
var _notifyObserversOfKey =
        function ( that, metadata, key, oldValue, newValue ) {
    var observers = metadata.observers[ key ],
        isInitialised = metadata.isInitialised,
        haveCheckedForNew = false,
        observer, object, method, path, l;
    if ( observers && ( l = observers.length ) ) {
        // Remember, observers may be removed (or possibly added, but that's
        // less likely) during the iterations. Clone array before iterating
        // to avoid the problem.
        observers = observers.slice();
        while ( l-- ) {
            observer = observers[l];
            object = observer.object || that;
            method = observer.method;
            // During initialisation, this method is only called when a
            // binding syncs. We want to give the illusion of the bound
            // properties being present on the object from the beginning, so
            // they can be used interchangably with non-bound properties, so
            // suppress notification of observers. However, if there is
            // another binding that is bound to this one, we need to notify
            // that to ensure it syncs the correct initial value.
            // We also need to set up any path observers correctly.
            if ( isInitialised ) {
                if ( path = observer.path ) {
                    // If it's a computed property we don't really want to call
                    // it unless it's needed; could be expensive.
                    if ( newValue === undefined && !haveCheckedForNew ) {
                        newValue = /^\d+$/.test( key ) ?
                            that.getObjectAt( parseInt( key, 10 ) ) :
                            that.get( key );
                        haveCheckedForNew = true;
                    }
                    // Either value could be null
                    if ( oldValue ) {
                        oldValue.removeObserverForPath( path, object, method );
                    }
                    if ( newValue ) {
                        newValue.addObserverForPath( path, object, method );
                    }
                    object[ method ]( that, key,
                        oldValue && oldValue.getFromPath( path ),
                        newValue && newValue.getFromPath( path ) );
                } else {
                    object[ method ]( that, key, oldValue, newValue );
                }
            } else {
                // Setup path observers on initial value.
                if ( newValue && ( path = observer.path ) ) {
                    newValue.addObserverForPath( path, object, method );
                }
                // Sync binding immediately
                if ( object instanceof NS.Binding ) {
                    object[ method ]();
                    object.sync();
                }
            }
        }
    }
};

/**
    Method (private): O.ObservableProps-_notifyGenericObservers

    Notifies any observers interested (registered as observing key '*') that
    at least one property has changed on this object.

    Parameters:
        that     - {O.ObservableProps} The object on which the property has
                   changed.
        metadata - {Object} The metadata for this object.
        changed  - {Object} A map of property names to another object. This
                   object has an oldValue and possibly a newValue property.
*/
var _notifyGenericObservers = function ( that, metadata, changed ) {
    var observers = metadata.observers[ '*' ],
        observer, l;
    if ( observers ) {
        l = observers.length;
        while ( l-- ) {
            observer = observers[l];
            ( observer.object || that )[ observer.method ]( that, changed );
        }
    }
};

/**
    Mixin: O.ObservableProps

    The O.ObservableProps mixin adds support for key-value observing to another
    class. Public properties should only be accessed and modified via the
    get/set methods inherited from <O.ComputedProps>.
*/

NS.ObservableProps = {

    /**
        Method: O.Observable#initObservers

        Initialises any observed paths on the object (observed keys do not
        require initialisation. You should never call this directly, but rather
        iterate through the keys of `O.meta( this ).inits`, calling
        `this[ 'init' + key ]()` for all keys which map to truthy values.
    */
    initObservers: function () {
        _setupTeardownPaths( this, 'addObserverForPath' );
    },

    /**
        Method: O.Observable#destroyObservers

        Removes any observed paths from the object (observed keys do not require
        destruction. You should never call this directly, but rather iterate
        through the keys of `O.meta( this ).inits`, calling
        `this[ 'destroy' + key ]()` for all keys which map to a truthy value.
    */
    destroyObservers: function () {
        _setupTeardownPaths( this, 'removeObserverForPath' );
    },

    /**
        Method: O.ObservableProps#hasObservers

        Returns true if any property on the object is currently being observed
        by another object.

        Returns:
            {Boolean} Does the object have any observers?
    */
    hasObservers: function () {
        var observers = meta( this ).observers,
            key, keyObservers, l, object;
        for ( key in observers ) {
            keyObservers = observers[ key ];
            l = keyObservers.length;
            while ( l-- ) {
                object = keyObservers[l].object;
                if ( object && object !== this &&
                        // Ignore bindings that belong to the object.
                        ( !object instanceof NS.Binding ||
                            object.toObject !== this ) ) {
                    return true;
                }
            }
        }
        return false;
    },

    /**
        Method: O.ObservableProps#beginPropertyChanges

        Call this before changing a set of properties (and then call
        <endPropertyChanges> afterwards) to ensure that if a dependent property
        changes more than once, observers of that property will only be notified
        once of the change. No observer will be called until
        the matching <endPropertyChanges> call is made.

        Returns:
            {O.ObservableProps} Returns self.
    */
    beginPropertyChanges: function () {
        meta( this ).depth += 1;
        return this;
    },

    /**
        Method: O.ObservableProps#endPropertyChanges

        Call this after changing a set of properties (having called
        <beginPropertyChanges> before) to ensure that if a dependent property
        changes more than once, observers of that property will only be notified
        once of the change.

        Returns:
            {O.ObservableProps} Returns self.
    */
    endPropertyChanges: function () {
        var metadata = meta( this ),
            changed, key;
        if ( metadata.depth === 1 ) {
            // Notify observers.
            while ( changed = metadata.changed ) {
                metadata.changed = null;
                for ( key in changed ) {
                    _notifyObserversOfKey( this, metadata,
                        key, changed[ key ].oldValue, changed[ key ].newValue );
                }
                // Notify observers interested in any property change
                if ( metadata.observers[ '*' ] ) {
                    _notifyGenericObservers( this, metadata, changed );
                }
            }
        }
        // Only decrement here so that any further property changes that happen
        // whilst we are notifying of the previous ones are queued up and then
        // distributed in the next loop.
        metadata.depth -= 1;
        return this;
    },

    /**
        Method: O.ObservableProps#propertyDidChange

        Overrides the method in <O.ComputedProps>. Invalidates any cached
        values depending on the property and notifies any observers about the
        change. Will also notify any observers of dependent values about the
        change.

        Parameters:
            key      - {String} The name of the property which has changed.
            oldValue - {*} The old value for the property.
            newValue - {*} (optional) The new value for the property. Only there
                       if it's not a computed property.

        Returns:
            {O.ObservableProps} Returns self.
    */
    propertyDidChange: function ( key, oldValue, newValue ) {
        var metadata = meta( this ),
            isInitialised = metadata.isInitialised,
            dependents = isInitialised ?
                this.propertiesDependentOnKey( key ) : [],
            l = dependents.length,
            depth = metadata.depth,
            hasGenericObservers = metadata.observers[ '*' ],
            fastPath = !l && !depth && !hasGenericObservers,
            changed = fastPath ? null : metadata.changed || {},
            cache = metadata.cache,
            prop;

        if ( fastPath ) {
            _notifyObserversOfKey( this, metadata, key, oldValue, newValue );
        } else {
            while ( l-- ) {
                prop = dependents[l];
                if ( !changed[ prop ] ) {
                    changed[ prop ] = {
                        oldValue: cache[ prop ]
                    };
                }
                delete cache[ prop ];
            }

            changed[ key ] = {
                oldValue: changed[ key ] ? changed[ key ].oldValue : oldValue,
                newValue: newValue
            };

            if ( metadata.depth ) {
                metadata.changed = changed;
            } else {
                // Notify observers of dependent keys.
                for ( prop in changed ) {
                    _notifyObserversOfKey( this, metadata, prop,
                        changed[ prop ].oldValue, changed[ prop ].newValue );
                }

                // Notify observers interested in any property change
                if ( isInitialised && hasGenericObservers ) {
                    _notifyGenericObservers( this, metadata, changed );
                }
            }
        }

        return this;
    },

    /**
        Method: O.ObservableProps#addObserverForKey

        Registers an object and a method to be called on that object whenever a
        particular key changes in value. The method will be called with the
        following parameters: obj, key, oldValue, newValue. If it is a computed
        property the oldValue and newValue arguments may not be present. You can
        also observe '*' to be notified of any changes to the object; in this
        case the observer will only be supplied with the first argument: this
        object.

        Parameters:
            key    - {String} The property to observer.
            object - {Object} The object on which to call the callback method.
            method - {String} The name of the callback method.

        Returns:
            {O.ObservableProps} Returns self.
    */
    addObserverForKey: function ( key, object, method ) {
        var observers = meta( this ).observers,
            keyObservers = observers[ key ];
        if ( !observers.hasOwnProperty( key ) ) {
            keyObservers = observers[ key ] = keyObservers ?
                keyObservers.slice() : [];
        }
        keyObservers.push({ object: object, method: method });
        return this;
    },

    /**
        Method: O.ObservableProps#removeObserverForKey

        Removes an object/method pair from the list of those to be called when
        the property changes. Must use identical arguments to a previous call to
        <addObserverForKey>.

        Parameters:
            key    - {String} The property which is being observed.
            object - {Object} The object which is observing it.
            method - {String} The name of the callback method on the observer
                     object.

        Returns:
            {O.ObservableProps} Returns self.
    */
    removeObserverForKey: function ( key, object, method ) {
        var observers = meta( this ).observers,
            keyObservers = observers[ key ],
            observer, l;
        if ( keyObservers ) {
            l = keyObservers.length;
            while ( l-- ) {
                observer = keyObservers[l];
                if ( observer.object === object &&
                        observer.method === method ) {
                    keyObservers.splice( l, 1 );
                    break;
                }
            }
            if ( !keyObservers.length ) {
                delete observers[ key ];
            }
        }
        return this;
    },

    /**
        Method: O.ObservableProps#addObserverForPath

        Registers an object and a method to be called on that object whenever
        any property in a given path string changes. Note, this path is live, in
        that if you observe `foo.bar.x` and `bar` changes, you will receive a
        callback, and the observer will be deregistered from the old `bar`, and
        registered on the new one.

        Parameters:
            path   - {String} The path to observe.
            object - {Object} The object on which to call the callback method.
            method - {String} The name of the callback method.

        Returns:
            {O.ObservableProps} Returns self.
    */
    addObserverForPath: function ( path, object, method ) {
        var nextDot = path.indexOf( '.' );
        if ( nextDot === -1 ) {
            this.addObserverForKey( path, object, method );
        }
        else {
            var key = path.slice( 0, nextDot ),
                value = this.get( key ),
                restOfPath = path.slice( nextDot + 1 ),
                observers = meta( this ).observers,
                keyObservers = observers[ key ];
            if ( !observers.hasOwnProperty( key ) ) {
                keyObservers = observers[ key ] = keyObservers ?
                    keyObservers.slice() : [];
            }

            keyObservers.push({
                path: restOfPath,
                object: object,
                method: method
            });
            if ( value && !( value instanceof NS.Binding ) ) {
                value.addObserverForPath( restOfPath, object, method );
            }
        }
        return this;
    },

    /**
        Method: O.ObservableProps#removeObserverForPath

        Removes an observer for a path added with <addObserverForPath>.

        Parameters:
            path   - {String} The path which is being observed.
            object - {Object} The object which is observing it.
            method - {String} The name of the callback method on the observer
                     object.

        Returns:
            {O.ObservableProps} Returns self.
    */
    removeObserverForPath: function ( path, object, method ) {
        var nextDot = path.indexOf( '.' );
        if ( nextDot === -1 ) {
            this.removeObserverForKey( path, object, method );
        }
        else {
            var key = path.slice( 0, nextDot ),
                value = this.get( key ),
                restOfPath = path.slice( nextDot + 1 ),
                observers = meta( this ).observers[ key ],
                observer, l;

            if ( observers ) {
                l = observers.length;
                while ( l-- ) {
                    observer = observers[l];
                    if ( observer.path === restOfPath &&
                         observer.object === object &&
                         observer.method === method) {
                            observers.splice( l, 1 );
                            break;
                    }
                }
            }
            if ( value ) {
                value.removeObserverForPath( restOfPath, object, method );
            }
        }
        return this;
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Object.js                                                            \\
// Module: Foundation                                                         \\
// Requires: ComputedProps.js, BoundProps.js, ObservableProps.js, EventTarget.js \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var meta = NS.meta;

/**
    Class: O.Object

    Includes: O.ComputedProps, O.BoundProps, O.ObservableProps, O.EventTarget

    This is the root class for almost every object in the rest of the library.
    It adds support for computed properties, bound properties, observable
    properties and subscribing/firing events.
*/
NS.Object = NS.Class({

    Mixin: [
        NS.ComputedProps, NS.BoundProps, NS.ObservableProps, NS.EventTarget
    ],

    /**
        Constructor: O.Object

        Parameters:
            mixin - {Object} (optional) Any properties in this object will be
                    added to the new O.Object instance before initialisation (so
                    you can pass it getter/setter functions or observing
                    methods).
    */
    init: function ( mixin ) {
        this.isDestroyed = false;

        NS.mixin( this, mixin );

        var metadata = meta( this ),
            inits = metadata.inits,
            method;
        for ( method in inits ) {
            if ( inits[ method ] ) {
                this[ 'init' + method ]();
            }
        }
        metadata.isInitialised = true;
    },

    /**
        Method: O.Object#destroy

        Removes any connections to other objects (e.g. path observers and
        bindings) so the object will be available for garbage collection.
    */
    destroy: function () {
        var destructors = meta( this ).inits,
            method;
        for ( method in destructors ) {
            if ( destructors[ method ] ) {
                this[ 'destroy' + method ]();
            }
        }

        this.isDestroyed = true;
    }
});

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ObservableRange.js                                                   \\
// Module: Foundation                                                         \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/**
    Mixin: O.ObservableRange

    The ObservableRange mixin adds support for observing an (integer-based)
    numerical range of keys to an observable object. The object is expected
    to have the ObservableProps mixin applied and have a length property.
*/

( function ( NS, undefined ) {

var meta = NS.meta;

NS.ObservableRange = {
    /**
        Method: O.ObservableRange#rangeDidChange

        Notifies observers that are observing a range which intersects the range
        that has changed. Also notifies any observers observing an individual
        number (via <O.ObservableProps#addObserverForKey>) and any observers
        looking out for a change to `[]` (enumerable content did change).

        Parameters:
            start - {Number} The index of the first value in the range to have
                    changed (indexed from 0).
            end   - {Number} The index of one past the last value in the range
                    to have changed.

        Returns:
            {O.ObservableRange} Returns self.
    */
    rangeDidChange: function ( start, end ) {
        if ( end === undefined ) { end = start + 1; }
        var metadata = meta( this ),
            key, index;
        for ( key in metadata.observers ) {
            index = parseInt( key, 10 );
            if ( start <= index && index < end ) {
                this.propertyDidChange( key );
            }
        }
        var observers = metadata.rangeObservers,
            l = observers ? observers.length : 0,
            enumerableLength = this.get( 'length' ) || 0;
        while ( l-- ) {
            var observer = observers[l],
                range = observer.range,
                observerStart = range.start || 0,
                observerEnd = 'end' in range ?
                    range.end : Math.max( enumerableLength, end );
            if ( observerStart < 0 ) { observerStart += enumerableLength; }
            if ( observerEnd < 0 ) { observerEnd += enumerableLength; }
            if ( observerStart < end && observerEnd > start ) {
                observer.object[ observer.method ]( this, start, end );
            }
        }
        this.computedPropertyDidChange( '[]' );
        return this;
    },

    /**
        Method: O.ObservableRange#addObserverForRange

        Registers an object and a method to be called on that object whenever an
        integer-referenced property in the given range changes. Note, the range
        is 'live'; you can change the start/end values in the object at any time
        and immediately receive notifications of updates in the new range.
        Negative values for start or end are allowed, and are treated as offsets
        from the end of the current length of this object, with -1 being the
        last item.

        Parameters:
            range  - {Object} The range to observe. May have either, both or
                     none of start and end properties. These are numerical
                     values, indexed from 0, negative values index from the end
                     of the enumerable object. If start is omitted it is taken
                     to be 0 (the first element in the enumerable). If end is
                     ommitted it is taken to be the length of the enumerable.
                     start is inclusive and end is exclusive, e.g. {start: 1,
                     end: 2} will only fire if index 1 changes.
            object - {Object} The object on which to call the callback method.
            method - {String} The name of the callback method.

        Returns:
            {O.ObservableRange} Returns self.
    */
    addObserverForRange: function ( range, object, method ) {
        var metadata = meta( this );
        ( metadata.rangeObservers || ( metadata.rangeObservers = [] ) ).push({
            range: range,
            object: object,
            method: method
        });
        return this;
    },

    /**
        Method: O.ObservableRange#removeObserverForRange

        Stops callbacks to an object/method when content changes occur within
        the range. Note, the range object passed must be the same as that passed
        for addObserverForRange, not just have the same properties (these could
        have changed due to the support for live updating of the observed range.
        See <O.ObservableRange#addObserverForRange> description).

        Parameters:
            range  - {Object} The range which is being observed.
            object - {Object} The object which is observing it.
            method - {String} The name of the callback method on the observer
                     object.

        Returns:
            {O.ObservableRange} Returns self.
    */
    removeObserverForRange: function ( range, object, method ) {
        var observers = meta( this ).rangeObservers,
            l = observers ? observers.length : 0;
        while ( l-- ) {
            var observer = observers[l];
            if ( observer.range === range &&
                 observer.object === object && observer.method === method ) {
                    observers.splice( l, 1 );
                    break;
            }
        }
        return this;
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ObservableArray.js                                                   \\
// Module: Foundation                                                         \\
// Requires: Object.js,ObservableRange.js,Enumerable.js,MutableEnumerable.js  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var splice = Array.prototype.splice;
var slice = Array.prototype.slice;

/**
    Class: O.ObservableArray

    Extends: O.Object

    Includes: O.ObservableRange, O.Enumerable, O.MutableEnumerable

    The ObservableArray class provides an object with the same interface as the
    standard array but with the difference that properties or even ranges can be
    observed. Note, all access must be via getObjectAt/setObjectAt, not direct
    array[i].
*/
var ObservableArray = NS.Class({

    Extends: NS.Object,

    Mixin: [ NS.ObservableRange, NS.Enumerable, NS.MutableEnumerable ],

    /**
        Constructor: O.ObservableArray

        Parameters:
            array   - {Array} (optional) The initial contents of the array.
            mixin - {Object} (optional)
    */
    init: function ( array, mixin ) {
        this._array = array || [];
        this._length = this._array.length;

        ObservableArray.parent.init.call( this, mixin );
    },

    /**
        Property: O.ObservableArray#[]
        Type: Array

        The standard array underlying the object. Observers of this property
        will be notified any time any content changes in the array. Setting this
        property changes the entire contents of the array at once. The contents
        of the new array is checked for equality with that of the old array to
        ensure accurate notification of the changed range.
    */
    '[]': function ( array ) {
        if ( array ) {
            var oldArray = this._array,
                oldLength = this._length,
                newLength = array.length,
                start = 0,
                end = newLength;

            this._array = array;
            this._length = newLength;

            while ( ( start < newLength ) &&
                    ( array[ start ] === oldArray[ start ] ) ) {
                start += 1;
            }
            if ( newLength === oldLength ) {
                var last = end - 1;
                while ( ( end > start ) &&
                        ( array[ last ] === oldArray[ last ] ) ) {
                    end = last;
                    last -= 1;
                }
            } else {
                end = Math.max( oldLength, newLength );
                this.propertyDidChange( 'length', oldLength, newLength );
            }

            if ( start !== end ) {
                this.rangeDidChange( start, end );
            }
        }
        return this._array.slice();
    }.property(),

    /**
        Method: O.ObservableArray#getObjectAt

        Returns the value at the index given in the array.

        Parameters:
            index - {Number} The index of the value to return.

        Returns:
            {*} The value at index i in this array.
    */
    getObjectAt: function ( index ) {
        return this._array[ index ];
    },

    /**
        Property: O.ObservableArray#length
        Type: Number

        The length of the array.
    */
    length: function ( value ) {
        var length = this._length;
        if ( typeof value === 'number' && value !== length ) {
            this._array.length = value;
            this._length = value;
            if ( value < length ) {
                this.rangeDidChange( value, length );
            }
            length = value;
        }
        return length;
    }.property().nocache(),

    /**
        Method: O.ObservableArray#setObjectAt

        Sets the value at a given index in the array.

        Parameters:
            index - {Number} The index at which to set the value.
            value - {*} The value to set it to.

        Returns:
            {O.ObservableArray} Returns self.
    */
    setObjectAt: function ( index, value ) {
        this._array[ index ] = value;
        var length = this._length;
        if ( length <= index ) {
            this._length = index + 1;
            this.propertyDidChange( 'length', length, index + 1 );
        }
        this.rangeDidChange( index );
        return this;
    },

    /**
        Method: O.ObservableArray#replaceObjectsAt

        Removes a given number of objects from the array, starting at the index
        given, and inserts a number of objects in their place.

        Parameters:
            index         - {Number} The index at which to remove/add objects.
            numberRemoved - {Number} The number of objects to remove.
            newItems      - {Array} (optional) The objects to insert.

        Returns:
            {Array} Returns an array of the removed objects.
    */
    replaceObjectsAt: function ( index, numberRemoved, newItems ) {
        var oldLength = this._length,
            array = this._array,
            removed, newLength, i, l;

        newItems = newItems ? slice.call( newItems ) : [];

        if ( oldLength <= index ) {
            for ( i = 0, l = newItems.length; i < l; i += 1 ) {
                array[ index + i ] = newItems[i];
            }
        } else {
            newItems.unshift( index, numberRemoved );
            removed = splice.apply( array, newItems );
        }
        newLength = array.length;
        if ( oldLength !== newLength ) {
            this._length = newLength;
            this.propertyDidChange( 'length', oldLength, newLength );
            this.rangeDidChange( index, Math.max( oldLength, newLength ) );
        } else {
            this.rangeDidChange( index, index + numberRemoved );
        }
        return removed || [];
    },

    // :: Mutation methods =====================================================

    /**
        Method: O.ObservableArray#sort

        ECMAScript Array#sort.

        Parameters:
            comparefn - {Function} (optional) The function to use to compare two
                        items in the array.

        Returns:
            {O.ObservableArray} Returns self.
    */
    sort: function ( comparefn ) {
        this._array.sort( comparefn );
        this.rangeDidChange( 0, this._length );
        return this;
    },

    /**
        Method: O.ObservableArray#reverse

        ECMAScript Array#reverse.

        Returns:
            {O.ObservableArray} Returns self.
    */
    reverse: function () {
        this._array.reverse();
        this.rangeDidChange( 0, this._length );
        return this;
    },

    // :: Accessor methods =====================================================

    /**
        Method: O.ObservableArray#concat

        ECMAScript Array#concat.

        Parameters:
            var_args - {...Array} The arrays to concatenate with this array.

        Returns:
            {Array} Returns new concatenated array.
    */
    concat: function () {
        var args = [],
            i, l, item;
        for ( i = 0, l = arguments.length; i < l; i += 1 ) {
            item = arguments[i];
            args[i] = item instanceof ObservableArray ? item._array : item;
        }
        return Array.prototype.concat.apply( this._array, args );
    },

    /**
        Method: O.ObservableArray#join

        ECMAScript Array#join.

        Parameters:
            separator - {String} (optional) The string to insert between each
                        item (defaults to ',').

        Returns:
            {String} Concatenated string of all items joined by separator
            string.
    */
    join: function ( separator ) {
        return this._array.join( separator );
    },

    /**
        Method: O.ObservableArray#slice

        ECMAScript Array#slice.

        Parameters:
            start - {Number} (optional) The index of the first item to include.
            end   - {Number} (optional) One past the index of the last item to
                    include.

        Returns:
            {Array} Shallow copy of the underlying array between the given
            indexes.
    */
    slice: function ( start, end ) {
        return this._array.slice( start, end );
    }
});

NS.ObservableArray = ObservableArray;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Transform.js                                                         \\
// Module: Foundation                                                         \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

/**
    Namespace: O.Transform

    Holds a number of useful functions for transforming values, for use with
    <O.Binding>.
*/
NS.Transform = {
    /**
        Function: O.Transform.toBoolean

        Converts the given value to a Boolean

        Parameter:
            value - {*} The value to transform.

        Returns:
            {Boolean} The numerical value.
    */
    toBoolean: function ( value ) {
        return !!value;
    },

    /**
        Function: O.Transform.toString

        Converts the given value to a String

        Parameter:
            value - {*} The value to transform.

        Returns:
            {String} The string value.
    */
    toString: function ( value ) {
        return value != null ? value + '' : '';
    },

    /**
        Function: O.Transform.toInt

        Converts the given value to an integer

        Parameter:
            value - {*} The value to transform.

        Returns:
            {Number} The integral numerical value.
    */
    toInt: function ( value ) {
        return parseInt( value, 10 ) || 0;
    },

    /**
        Function: O.Transform.toFloat

        Converts the given value to a floating point Number.

        Parameter:
            value - {*} The value to transform.

        Returns:
            {Number} The numerical value.
    */
    toFloat: function ( value ) {
        return parseFloat( value );
    },

    /**
        Function: O.Transform.invert

        Converts the given value to a Boolean then inverts it.

        Parameter:
            value - {*} The value to transform.

        Returns:
            {Boolean} The inverse Boolean value.
    */
    invert: function ( value ) {
        return !value;
    },

    /**
        Function: O.Transform#defaultValue

        Returns a function which will transform `undefined` into the default
        value, but will pass through any other value untouched.

        Parameters:
            value - {*} The default value to use.
    */
    defaultValue: function ( value ) {
        return function ( v ) {
            return v !== undefined ? v : value;
        };
    },

    /**
        Function: O.Transform.undefinedToNull

        Converts an undefined value into null, passes others through unchanged.

        Parameter:
            value - {*} The value to transform.

        Returns:
            {*} The value or null if the value is undefined.
    */
    undefinedToNull: function ( value ) {
        return value === undefined ? null : value;
    },

    /**
        Function: O.Transform.isEqualToValue

        Returns a function which will compare a given value to the value

        Parameter:
            value - {*} The value to compare to.

        Returns:
            {Function} A function which compares its first argument to the value
            given to this function, returning true if equal or false otherwise.
            Or, if the sync is in reverse, returns the given value if true or
            undefined if false.
    */
    isEqualToValue: function ( value ) {
        return function ( syncValue, syncForward ) {
            return syncForward ?
                syncValue === value :
                syncValue ? value : undefined;
        };
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: UA.js                                                                \\
// Module: UA                                                                 \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global navigator, document, window */

/**
    Module: UA

    The UA module contains information about the platform on which the
    application is running.
*/
( function ( NS ) {

var ua = navigator.userAgent.toLowerCase(),
    other = [ 'other', '0' ],
    platform = /ip(?:ad|hone|od)/.test( ua ) ? 'ios' : (
        /android|webos/.exec( ua ) ||
        /mac|win|linux/.exec( navigator.platform.toLowerCase() ) ||
        other
    )[0],
    browser = ( /chrome|opera|safari|firefox|msie/.exec( ua ) || other )[0],
    version = parseFloat(
        ( /(?:version\/|chrome\/|firefox\/|msie\s|os )(\d+(?:[._]\d+)?)/.exec( ua )|| other )[1].replace( '_', '.' )
    ),
    cssPrefixes = {
        chrome: '-webkit-',
        firefox: '-moz-',
        msie: '-ms-',
        opera: '-o-',
        safari: '-webkit-',
        other: '-webkit-'
    },
    cssProps = {};

( function () {
    var el = document.createElement( 'div' ),
        style = el.style,
        props = {
            'box-shadow': {
                name: 'box-shadow',
                value: '0 0 0 #000'
            },
            transform: {
                name: 'transform',
                value: 'translateX(0)'
            },
            transform3d: {
                name: 'transform',
                value: 'translateZ(0)'
            },
            transition: {
                name: 'transition',
                value: 'all .3s'
            },
            perspective: {
                name: 'perspective',
                value: '1px'
            },
            'user-select': {
                name: 'user-select',
                value: 'none'
            }
        },
        prefix = cssPrefixes[ browser ],
        prop, test, css;

    for ( prop in props ) {
        test = props[ prop ];
        css = test.name + ':' + test.value;
        style.cssText = css;
        if ( style.length ) {
            cssProps[ prop ] = test.name;
        } else {
            style.cssText = prefix + css;
            cssProps[ prop ] = style.length ? prefix + test.name : null;
        }
    }
    style.cssText = 'display:flex';
    if ( style.length ) {
        cssProps.flexbox = 'flex';
    } else {
        style.cssText = 'display:' + prefix + 'flex';
        cssProps.flexbox = el.style.length ? prefix + 'flex' : null;
    }
    css = cssProps.transition;
    [ 'delay', 'timing', 'duration', 'property' ].forEach( function ( prop ) {
        cssProps[ 'transition-' + prop ] = css ? css + '-' + prop : null;
    });
    el = null;
    style = null;

    // Browser bugs:
    // 1. iOS5 Sometimes fails to transform stuff.
    // 2. Chrome on Windows XP has edge case bugs like
    //    not rendering scroll bars in transformed elements.
    if ( ( platform === 'ios' && version < 6 ) ||
            /windows nt 5.1/.test( ua ) ) {
        cssProps.transform3d = false;
    }
}() );

/**
    Namespace: O.UA

    The O.UA namespace contains information about which browser and platform the
    application is currently running on, and which CSS properties are supported.
*/
NS.UA = {
    /**
        Property: O.UA.platform
        Type: String

        The operating system being run: "mac", "win", "linux", "android",
        "ios", "webos" or "other.
    */
    platform: platform,

    /**
        Property: O.UA.isMac
        Type: Boolean

        True if running on a mac.
    */
    isMac: platform === 'mac',
    /**
        Property: O.UA.isWin
        Type: Boolean

        True if running on windows.
    */
    isWin: platform === 'win',
    /**
        Property: O.UA.isLinux
        Type: Boolean

        True if running on linux.
    */
    isLinux: platform === 'linux',
    /**
        Property: O.UA.isIOS
        Type: Boolean

        True if running on iOS.
    */
    isIOS: platform === 'ios',

    /**
        Property: O.UA.isAndroid
        Type: Boolean

        True if running on Android.
    */
    isAndroid: platform === 'android',

    /**
        Property: O.UA.browser
        Type: String

        The browser being run. "chrome", "firefox", "msie" or "opera" or
        "safari".
    */
    browser: browser,
    /**
        Property: O.UA.version
        Type: Number

        The browser version being run. This is a float, and includes the first
        minor revision as well as the major revision. For example, if the user
        is running Opera 12.5, this will be `12.5`, not just `12`.
    */
    version: version,

    /**
        Property: O.UA.chrome
        Type: Number

        If running Chrome, this will be the version number running. Otherwise 0.
    */
    chrome: browser === 'chrome' ? version : 0,
    /**
        Property: O.UA.firefox
        Type: Number

        If running Firefox, this will be the version number running. Otherwise
        0.
    */
    firefox: browser === 'firefox' ? version : 0,
    /**
        Property: O.UA.msie
        Type: Number

        If running Internet Explorer, this will be the version number running.
        Otherwise 0.
    */
    msie: browser === 'msie' ? version : 0,
    /**
        Property: O.UA.opera
        Type: Number

        If running Opera, this will be the version number running. Otherwise 0.
    */
    opera: browser === 'opera' ? version : 0,
    /**
        Property: O.UA.safari
        Type: Number

        If running Safari, this will be the version number running. Otherwise 0.
    */
    safari: browser === 'safari' ? version : 0,
    /**
        Property: O.UA.operaMobile
        Type: Number

        If running Opera Mobile, this will be the version number running.
        Otherwise 0.
    */
    operaMobile: /opera mobi/.test( ua ) ? version : 0,

    /**
        Property: O.UA.operaMini
        Type: Number

        If running Opera Mini, this will be the version number running.
        Otherwise 0.
    */
    operaMini: !!window.operamini ? version : 0,

    /**
        Property: O.UA.cssProps
        Type: Object

        A map of certain CSS property names to the browser-specific CSS property
        name required, or null if the browser does not support the property.

        The following properties are available: box-shadow, float, transform,
        transform3d, transition, transition-delay, transition-duration,
        transition-property and transition-timing.
    */
    cssProps: cssProps,
    /**
        Property: O.UA.cssPrefix
        Type: String

        The CSS prefix to use for this browser.
    */
    cssPrefix: cssPrefixes[ browser ],

    /**
        Property: O.UA.canTouch
        Type: Boolean

        Does the browser support touch events?
    */
    canTouch: 'ontouchstart' in document.documentElement
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Easing.js                                                            \\
// Module: Animation                                                          \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Function (private): O.Easing-cubicBezier

    Returns a function that, for the given cubic bezier control points, returns
    the y position given an x position. p0 is presumed to be (0,0) and p3 is
    presumed to be (1,1).

    Parameters:
        p1x - {Number} The x-coordinate for point 1.
        p1y - {Number} The y-coordinate for point 1.
        p2x - {Number} The x-coordinate for point 2.
        p2y - {Number} The y-coordinate for point 2.

    Returns:
        {Function} A function representing the cubic bezier with the points
        given.
*/
var cubicBezier = function ( p1x, p1y, p2x, p2y ) {
    // Calculate constants in parametric bezier formular
    // http://www.moshplant.com/direct-or/bezier/math.html
    var cX = 3 * p1x,
        bX = 3 * ( p2x - p1x ) - cX,
        aX = 1 - cX - bX,

        cY = 3 * p1y,
        bY = 3 * ( p2y - p1y ) - cY,
        aY = 1 - cY - bY;

    // Functions for calculating x, x', y for t
    var bezierX = function ( t ) {
        return t * ( cX + t * ( bX + t * aX ) );
    };
    var bezierXDerivative = function ( t ) {
        return cX + t * ( 2 * bX + 3 * aX * t );
    };

    // Use Newton-Raphson method to find t for a given x.
    // Since x = a*t^3 + b*t^2 + c*t, we find the root for
    // a*t^3 + b*t^2 + c*t - x = 0, and thus t.
    var newtonRaphson = function ( x ) {
        var prev,
            // Initial estimation is linear
            t = x;
        do {
            prev = t;
            t = t - ( ( bezierX( t ) - x ) / bezierXDerivative( t ) );
        } while ( Math.abs( t - prev ) > 1e-4 );

        return t;
    };

    return function ( x ) {
        var t = newtonRaphson( x );
        // This is y given t on the bezier curve.
        return t * ( cY + t * ( bY + t * aY ) );
    }.extend({
        cssName: 'cubic-bezier(' + p1x + ',' + p1y + ',' + p2x + ',' + p2y + ')'
    });
};

/**
    Object: O.Easing

    Holds functions emulating the standard CSS easing functions.
*/
NS.Easing = {
    /**
        Function: O.Easing#linear

        Linear easing.

        Parameters:
            n - {Number} A number between 0 and 1 representing the current
                position in the animation.

        Returns:
            {Number} The position along the animation path (between 0 and 1).
    */
    linear: function ( n ) {
        return n;
    }.extend({ cssName: 'linear' }),

    /**
        Function: O.Easing#ease

        Equivalent to the CSS ease transition, a cubic bezier curve with control
        points (0.25, 0.1) and (0.25, 1).

        Parameters:
            n - {Number} A number between 0 and 1 representing the current
                position in the animation.

        Returns:
            {Number} The position along the animation path (between 0 and 1).
    */
    ease: cubicBezier( 0.25, 0.1, 0.25, 1 ),

    /**
        Function: O.Easing#easeIn

        Equivalent to the CSS easeIn transition, a cubic bezier curve with
        control points (0.42, 0) and (1, 1).

        Parameters:
            n - {Number} A number between 0 and 1 representing the current
                position in the animation.

        Returns:
            {Number} The position along the animation path (between 0 and 1).
    */
    easeIn: cubicBezier( 0.42, 0, 1, 1 ),

    /**
        Function: O.Easing#easeOut

        Equivalent to the CSS easeOut transition, a cubic bezier curve with
        control points (0, 0) and (0.58, 1).

        Parameters:
            n - {Number} A number between 0 and 1 representing the current
                position in the animation.

        Returns:
            {Number} The position along the animation path (between 0 and 1).
    */
    easeOut: cubicBezier( 0, 0, 0.58, 1 ),

    /**
        Function: O.Easing#easeInOut

        Equivalent to the CSS easeInOut transition, a cubic bezier curve with
        control points (0.42, 0) and (0.58, 1).

        Parameters:
            n - {Number} A number between 0 and 1 representing the current
                position in the animation.

        Returns:
            {Number} The position along the animation path (between 0 and 1).
    */
    easeInOut: cubicBezier( 0.42, 0, 0.58, 1 )
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Animation.js                                                         \\
// Module: Animation                                                          \\
// Requires: Core, Foundation, Easing.js                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

// List of currently active animations
var animations = [];

// Draw the next frame in all currently active animations.
var nextFrame = function () {
    // Cache to local variable for speed
    var anims = animations,
        l = anims.length,
        time = NS.RunLoop.frameStartTime,
        objAnimations, i,
        hasMultiple, animation, object, animTime, duration;

    if ( l ) {
        // Request first to get in shortest time.
        NS.RunLoop.invokeInNextFrame( nextFrame );

        while ( l-- ) {
            objAnimations = anims[l];
            i = objAnimations.length;
            hasMultiple = i > 1;
            if ( hasMultiple ) {
                object = objAnimations[0].object;
                object.beginPropertyChanges();
            }
            while ( i-- ) {
                animation = objAnimations[i];
                animTime = time - animation.startTime;
                // For Safari 7, sigh.
                if ( animTime === time ) {
                    animation.startTime = time;
                    animTime = 0;
                }
                duration = animation.duration;
                if ( animTime < duration ) {
                    animation.drawFrame(
                        // Normalised position along timeline [0..1].
                        animation.ease( animTime / duration ),
                        // Normalised time animation has been running.
                        animTime
                    );
                } else {
                    animation.drawFrame( 1, duration );
                    animation.stop();
                }
            }
            if ( hasMultiple ) {
                object.endPropertyChanges();
            }
        }
    }
};

var meta = NS.meta;

/**
    Class: O.Animation

    At its core, O.Animation just repeatedly calls a method,
    <O.Animation#drawFrame>, over a given time period, supplying it with a
    number between 0 and 1 to tell it how far through the animation it currently
    is. This number is modified according to the easing function specified.

    The default implementation will set a numeric property on an object,
    interpolating between the initial value of the property and the value it's
    asked to transition to. If this is what you want to do, simply initialise
    your O.Animation instance with an "object" and a "property" value.

    For animating something other than a numeric property, override
    <O.Animation#prepare> and <O.Animation#drawFrame> methods.
*/
NS.Animation = NS.Class({

    init: function ( mixin ) {
        this.duration = this.duration;
        this.ease = this.ease;
        this.isRunning = false;
        this.startTime = 0;

        this.startValue = null;
        this.endValue = null;
        this.deltaValue = null;

        NS.extend( this, mixin );
    },

    /**
        Property: O.Animation#duration
        Type: Number
        Default: 300

        The length, in milliseconds, that the animation should last.
    */
    duration: 300,

    /**
        Property: O.Animation#ease
        Type: Function
        Default: O.Easing.ease

        The easing function to use for the animation.
    */
    ease: NS.Easing.ease,

    /**
        Property: O.Animation#isRunning
        Type: Boolean

        Is the animation currently in progress?
    */

    /**
        Property (private): O.Animation#startTime
        Type: Number

        A timestamp for when the animation began. Do not alter manually.
    */

    /**
        Property: O.Animation#object
        Type: Object

        The object on which to set the property during animation.
    */

    /**
        Property: O.Animation#property
        Type: String

        The name of the property to set on the object being animated.
    */

    /**
        Method: O.Animation#animate

        Transition to a new (given) value. If it is currently in the middle of
        an animation, that will be stopped and the new animation will transition
        from whatever the current value is to the new value.

        Parameters:
            value    - {*} The new value to animate to.
            duration - {Number} (optional) The length of the animation (in ms).
            ease     - {Function} (optional) The easing function to use.

        Returns:
            {O.Animation} Returns self.
    */
    animate: function ( value, duration, ease ) {
        if ( this.isRunning ) {
            this.stop();
        }
        if ( duration != null ) {
            this.duration = duration;
        }
        if ( ease != null ) {
            this.ease = ease;
        }

        // Prepare any values. Check we've actually got something to animate.
        if ( !this.prepare( value ) ) {
            return this;
        }

        var object = this.object,
            metadata = meta( object ),
            objAnimations = metadata.animations || ( metadata.animations = [] );

        this.startTime = 0;

        // Start loop if no current animations
        if ( !animations.length ) {
            NS.RunLoop.invokeInNextFrame( nextFrame );
        }

        // And add objectAnimations to animation queue
        if ( !objAnimations.length ) {
            animations.push( objAnimations );
        }
        objAnimations.push( this );

        // Now running
        this.isRunning = true;
        // Let object know animation has begun.
        if ( object.willAnimate ) {
            object.willAnimate( this );
        }
        return this;
    },

    /**
        Method (protected): O.Animation#prepare

        Called at the beginning of a new animation to perform any calculations
        that are constant in every frame, or otherwise initialise the animation.

        Parameters:
            value - {*} The new value to be transitioned to.

        Returns:
            {Boolean} Is there anything to actually animate. Returns false if
            the value is already at the desired end point.
    */
    prepare: function ( value ) {
        if ( typeof value === 'object' ) {
            this.startValue = value.startValue;
            this.endValue = value.endValue;
        } else {
            this.startValue = this.object.get( this.property );
            this.endValue = value;
        }
        this.deltaValue = this.endValue - this.startValue;

        return !!this.deltaValue;
    },

    /**
        Method (protected): O.Animation#drawFrame

        Called 60 times a second (or as frequently as the browser can manage)
        whilst the animation is in progress to draw each frame in the animation.
        The default implementation just interpolates from the start (numeric)
        value to the end (numeric)value and sets the <#property> on the
        <#object> with the new value. Override this method to do something
        different when drawing a frame.

        Parameters:
            position - {Number} A number, normally between 0 and 1, giving the
                       position in the animation, modified by the easing
                       function (the easing function may cause the number to go
                       beyond 0 and 1).
    */
    drawFrame: function ( position/*, time*/ ) {
        // And interpolate to find new value.
        var value = position < 1 ?
            this.startValue + ( position * this.deltaValue ) :
            this.endValue;

        this.object.set( this.property, value );
    },

    /**
        Method: O.Animation#stop

        Stop the animation (at the current position), if it is in progress.

        Returns:
            {O.Animation} Returns self.
    */
    stop: function () {
        if ( this.isRunning ) {
            // Remove from animation lists.
            var object = this.object,
                objAnimations = meta( object ).animations;
            objAnimations.erase( this );

            if ( !objAnimations.length ) {
                animations.erase( objAnimations );
            }
            // Not running any more
            this.isRunning = false;
            // Let object know animation has finished.
            if ( object.didAnimate ) {
                object.didAnimate( this );
            }
        }

        return this;
    }
});

}( O ) );


// -------------------------------------------------------------------------- \\
// File: AnimatableView.js                                                    \\
// Module: Animation                                                          \\
// Requires: Core, UA, Animation.js                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Mixin: O.AnimatableView

    Mix this into an <O.View> class to automatically animate all changes to the
    view's <O.View#layerStyles> property.
*/
NS.AnimatableView = {

    /**
        Property: O.AnimatableView#animateLayer
        Type: Boolean
        Default: true

        If true, changes to the view's <O.View#layerStyles> property will be
        animated. If false, the changes will be set without animation.
    */
    animateLayer: true,

    /**
        Property: O.AnimatableView#animateLayerDuration
        Type: Number
        Default: 300

        The length of time in milliseconds to animate changes to the view's
        layer styles.
    */
    animateLayerDuration: 300,

    /**
        Property: O.AnimatableView#animateLayerEasing
        Type: Function
        Default: O.Easing.ease

        The easing function to use for the animation of the view's layer styles.
    */
    animateLayerEasing: NS.Easing.ease,

    /**
        Property: O.AnimatableView#animating
        Type: Number

        The number of properties on the view currently being animated. Note,
        <O.View#layerStyles> counts as a single property.
    */
    animating: 0,

    /**
        Method: O.AnimatableView#willAnimate

        This method is called by the <O.Animation> class when it begins
        animating a property on the object. Increments the <#animating>
        property.
    */
    willAnimate: function () {
        this.increment( 'animating', 1 );
    },

    /**
        Method: O.AnimatableView#didAnimate

        This method is called by the <O.Animation> class when it finshes
        animating a property on the object. Decrements the <#animating>
        property.
    */
    didAnimate: function () {
        this.increment( 'animating', -1 );
    },

    /**
        Property: O.AnimatableView#layerAnimation
        Type: O.CSSStyleAnimation|O.StyleAnimation

        An appropriate animation object (depending on browser support) to
        animate the layer styles. Automatically generated when first accessed.
    */
    layerAnimation: function () {
        var Animation = NS.UA.cssProps.transition ?
            NS.CSSStyleAnimation : NS.StyleAnimation;
        return new Animation({
            object: this,
            element: this.get( 'layer' )
        });
    }.property(),

    /**
        Method: O.AnimatableView#redrawLayerStyles

        Overrides <O.View#redrawLayerStyles> to animate the change in styles
        instead of setting them immediately.

        Parameters:
            layer     - {Element} The view's layer.
            oldStyles - {Object|null} The previous layer styles for the view.
    */
    redrawLayerStyles: function ( layer, oldStyles ) {
        var newStyles = this.get( 'layerStyles' ),
            layerAnimation = this.get( 'layerAnimation' ),
            setStyle = NS.Element.setStyle,
            property, value;

        // Animate
        if ( this.get( 'animateLayer' ) && this.get( 'isInDocument' ) ) {
            if ( !layerAnimation.current ) {
                layerAnimation.current = oldStyles || newStyles;
            }
            layerAnimation.animate(
                newStyles,
                this.get( 'animateLayerDuration' ),
                this.get( 'animateLayerEasing' )
            );
        }
        // Or just set.
        else {
            layerAnimation.stop();
            layerAnimation.current = newStyles;
            setStyle( layer, 'transition-property', 'none' );
            for ( property in newStyles ) {
                value = newStyles[ property ];
                if ( value !== oldStyles[ property ] ) {
                    setStyle( layer, property, value );
                }
            }
        }
        // Just remove styles that are not specified in the new styles, but were
        // in the old styles
        for ( property in oldStyles ) {
            if ( !( property in newStyles ) ) {
                setStyle( layer, property, null );
            }
        }
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: CSSStyleAnimation.js                                                 \\
// Module: Animation                                                          \\
// Requires: Core, Foundation, Easing.js                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS ) {

/*
    Usage

    new CSSStyleAnimation({ element: el }).animate({
        opacity: 0,
        height: '300px',
        transform: 'foo'
    }, 300, ease ).wait( 40 ).animate({
        opacity: 1
    }, 250, ease );

    Will animate from current values
*/

/**
    Object: O.CSSStyleAnimationController

    Monitors for transitionend events and notifies the relevant
    CSSStyleAnimation class that its animation has finished.
    There is normally no reason to interact with this object directly.
*/
var CSSStyleAnimationController = {
    /**
        Property: O.CSSStyleAnimationController.animations
        Type: Object

        Maps elements (by guid) to transitions currently occurring on them.
    */
    animations: {},

    /**
        Method: O.CSSStyleAnimationController.register

        Associates an element with the <O.CSSStyleAnimation> object that is
        managing its animation.

        Parameters:
            el        - {Element} The element being animated.
            animation - {O.CSSStyleAnimation} The animation controller.
    */
    register: function ( el, animation ) {
        this.animations[ NS.guid( el ) ] = animation;
    },

    /**
        Method: O.CSSStyleAnimationController.deregister

        Removes an element and its animation controller from the <#animations>
        map.

        Parameters:
            el - {Element} The element that was being animated.
    */
    deregister: function ( el ) {
        delete this.animations[ NS.guid( el ) ];
    },

    /**
        Method: O.CSSStyleAnimationController.handleEvent

        Handles the transitionend event. Notifies the relevant animation
        controller that the transition has finished.

        Parameters:
            event - {Event} The transitionend event object.
    */
    handleEvent: function ( event ) {
        var animation = this.animations[ NS.guid( event.target ) ],
            property = event.propertyName;
        if ( animation ) {
            event.stopPropagation();
            animation.transitionEnd(
                Object.keyOf( NS.UA.cssProps, property ) || property,
                event.elapsedTime
            );
        }
    }.invokeInRunLoop()
};
[ 'transitionend', 'webkitTransitionEnd', 'oTransitionEnd' ].forEach(
function ( type ) {
    document.addEventListener( type, CSSStyleAnimationController, true );
});

/**
    Class: O.CSSStyleAnimation

    Animates the CSS properties of an element using CSS transitions. When
    initialised, you should set the <#element> property to the element you wish
    to animate and the <#current> property to an object of the current styles
    on the object.
*/
var CSSStyleAnimation = NS.Class({

    init: function ( mixin ) {
        this._deadMan = null;

        this.duration = 300;
        this.ease = NS.Easing.ease;
        this.isRunning = false;
        this.animating = [];
        this.current = null;

        NS.extend( this, mixin );
    },

    /**
        Property: O.CSSStyleAnimation#duration
        Type: Number
        Default: 300

        The length, in milliseconds, that the animation should last.
    */

    /**
        Property: O.CSSStyleAnimation#ease
        Type: Function
        Default: O.Easing.ease

        The easing function to use for the animation. Must be one with a CSS
        transition equivalent.
    */

    /**
        Property: O.CSSStyleAnimation#isRunning
        Type: Boolean

        Is the animation currently in progress?
    */

    /**
        Property: O.CSSStyleAnimation#element
        Type: Element

        The element this <O.CSSStyleAnimation> instance is animating.
    */

    /**
        Property: O.CSSStyleAnimation#current
        Type: Object

        The current styles applied to the element.
    */

    /**
        Method: O.CSSStyleAnimation#animate

        Transition the element to a new set of styles.

        Parameters:
            styles   - {Object} The new styles for the element.
            duration - {Number} (optional) The length of the animation (in ms).
            ease     - {Function} (optional) The easing function to use.

        Returns:
            {O.CSSStyleAnimation} Returns self.
    */
    animate: function ( styles, duration, ease ) {
        if ( this.isRunning ) {
            this.stop();
        }
        if ( duration != null ) {
            this.duration = duration;
        }
        if ( ease != null ) {
            this.ease = ease;
        }

        var el = this.element,
            current = this.current,
            animating = this.animating,
            object = this.object,
            setStyle = NS.Element.setStyle,
            property, value;

        this.current = styles;

        for ( property in styles ) {
            value = styles[ property ];
            if ( value !== current[ property ] ) {
                animating.push( property );
                setStyle( el, property, value );
            }
        }

        if ( animating.length ) {
            setStyle( el, 'transition',
                'all ' + this.duration + 'ms ' + this.ease.cssName );

            this.isRunning = true;
            // If the CSS property was transitioning from x -> y, and now we ask
            // it to transition from y -> x, it may already be at x, even though
            // the style attribute reads as y. In this case, it may not fire a
            // transitionend event. Set a timeout for 100ms after the duration
            // as a deadman switch to rescue it in this case.
            this._deadMan = NS.RunLoop.invokeAfterDelay(
                this.stop, this.duration + 100, this );

            if ( object && object.willAnimate ) {
                object.willAnimate( this );
            }

            CSSStyleAnimationController.register( el, this );
        }

        return this;
    },

    /**
        Method: O.CSSStyleAnimation#transitionEnd

        Called by <O.CSSStyleAnimationController> when a style finishes
        transitioning on the element.

        Parameters:
            property - {String} The name of the style that has finished
                       transitioning.
    */
    transitionEnd: function ( property ) {
        var animating = this.animating,
            index = animating.indexOf( property );
        if ( index > -1 ) {
            animating.splice( index, 1 );
            if ( !animating.length ) { this.stop(); }
        }
    },

    /**
        Method: O.CSSStyleAnimation#stop

        Stops the animation, if it is in progress. Note, this will immediately
        transition the styles to the end value of the current animation. It
        will not leave them in their partway point.

        Returns:
            {O.CSSStyleAnimation} Returns self.
    */
    stop: function () {
        if ( this.isRunning ) {
            this.isRunning = false;
            this.animating.length = 0;
            NS.RunLoop.cancel( this._deadMan );

            CSSStyleAnimationController.deregister( this.element );

            NS.Element.setStyle( this.element, 'transition', 'none' );

            var object = this.object;
            if ( object && object.didAnimate ) {
                object.didAnimate( this );
            }
        }
        return this;
    }
});

NS.CSSStyleAnimationController = CSSStyleAnimationController;
NS.CSSStyleAnimation = CSSStyleAnimation;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: StyleAnimation.js                                                    \\
// Module: Animation                                                          \\
// Requires: Animation.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var transformSplitter = /(\-?\d*\.\d+|\-?\d+)/;
var numbersToNumber = function ( item, index ) {
    return index & 1 ? parseFloat( item ) : item;
};
var styleAnimators = {
    display: {
        calcDelta: function ( startValue, endValue ) {
            return endValue === 'none' ? startValue : endValue;
        },
        calcValue: function ( position, deltaValue, startValue ) {
            return position ? deltaValue : startValue;
        }
    },
    transform: {
        calcDelta: function ( startValue, endValue ) {
            var start = startValue
                    .split( transformSplitter )
                    .map( numbersToNumber ),
                end = endValue
                    .split( transformSplitter )
                    .map( numbersToNumber );
            if ( start.length !== end.length ) {
                start = [ startValue ];
                end = [ endValue ];
            }
            return {
                start: start,
                delta: end.map( function ( value, index ) {
                    return index & 1 ? value - start[ index ] : 0;
                })
            };
        },
        calcValue: function ( position, deltaValue ) {
            var start = deltaValue.start,
                delta = deltaValue.delta,
                transform = start[0],
                i, l;
            for ( i = 1, l = start.length; i < l; i += 2 ) {
                transform += start[ i ] + ( position * delta[ i ] );
                transform += start[ i + 1 ];
            }
            return transform;
        }
    }
};

var supported = {
    display: 1,

    top: 1,
    right: 1,
    bottom: 1,
    left: 1,

    width: 1,
    height: 1,

    transform: 1,

    opacity: 1
};

/**
    Class: O.StyleAnimation

    Extends: O.Animation

    Animates the CSS styles of an element without using CSS transitions. This is
    used in browsers that don't support CSS transitions, but could also be
    useful if you want to animate an element using an easing method not
    supported by CSS transitions.

    Note, only the following CSS properties are currently supported by this
    class (all others will be set immediately without transition):

    * top
    * right
    * bottom
    * left
    * width
    * height
    * transform (values must be in matrix form)
    * opacity
*/
var StyleAnimation = NS.Class({

    Extends: NS.Animation,

    /**
        Method (protected): O.StyleAnimation#prepare

        Goes through the new styles for the element, works out which of these
        can be animated, and caches the delta value (difference between end and
        start value) for each one to save duplicated calculation when drawing a
        frame.

        Parameters:
            styles - {Object} A map of style name to desired value.

        Returns:
            {Boolean} True if any of the styles are going to be animated.
    */
    prepare: function ( styles ) {
        var animated = this.animated = [],
            from = this.startValue = this.current,
            current = this.current = NS.clone( from ),
            delta = this.deltaValue = {},
            units = this.units = {},

            property, start, end, animator;

        this.endValue = styles;

        for ( property in styles ) {
            start = from[ property ] || 0;
            end = styles[ property ] || 0;
            if ( start !== end ) {
                // We only support animating key layout properties.
                if ( supported[ property ] ) {
                    animated.push( property );
                    animator = styleAnimators[ property ];
                    if ( animator ) {
                        delta[ property ] = animator.calcDelta( start, end );
                    } else {
                        units[ property ] =
                            ( typeof start === 'string' &&
                                start.replace( /[\.\-\d]/g, '' ) ) ||
                            ( typeof end === 'string' &&
                                end.replace( /[\.\-\d]/g, '' ) ) ||
                            // If no unit specified, using 0 will ensure
                            // the value passed to setStyle is a number, so
                            // it will add 'px' if appropriate.
                            0;
                        start = from[ property ] = parseInt( start, 10 );
                        delta[ property ] = parseInt( end, 10 ) - start;
                    }
                } else {
                    current[ property ] = end;
                    NS.Element.setStyle( this.element, property, end );
                }
            }
        }
        return !!animated.length;
    },

    /**
        Method (protected): O.StyleAnimation#drawFrame

        Updates the animating styles on the element to the interpolated values
        at the position given.

        Parameters:
            position - {Number} The position in the animation.
    */
    drawFrame: function ( position ) {
        var animated = this.animated,
            l = animated.length,

            from = this.startValue,
            to = this.endValue,
            difference = this.deltaValue,
            units = this.units,
            current = this.current,

            el = this.element,
            setStyle = NS.Element.setStyle,
            property, value, start, end, delta, unit, animator;

        while ( l-- ) {
            property = animated[l];

            // Calculate new value.
            start = from[ property ] || 0;
            end = to[ property ] || 0;
            delta = difference[ property ];
            unit = units[ property ];

            animator = styleAnimators[ property ];

            value = current[ property ] = position < 1 ?
                animator ?
                    animator.calcValue( position, delta, start, end ) :
                    ( start + ( position * delta ) ) + unit :
                end;

            // And set.
            setStyle( el, property, value );
        }
    }
});

NS.StyleAnimation = StyleAnimation;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: DOMEvent.js                                                          \\
// Module: DOM                                                                \\
// Requires: Core                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Namespace: O.DOMEvent

    O.DOMEvent contains functions for use with DOM event objects
*/
var DOMEvent = {
    /**
        Property: O.DomEvent.keys
        Type: Object

        Maps the names of special keys to their key code.
    */
    keys: {
        8: 'backspace',
        9: 'tab',
        13: 'enter',
        16: 'shift',
        17: 'control',
        18: 'alt',
        20: 'capslock',
        27: 'esc',
        32: 'space',
        33: 'pageup',
        34: 'pagedown',
        35: 'end',
        36: 'home',
        37: 'left',
        38: 'up',
        39: 'right',
        40: 'down',
        46: 'delete',
        144: 'numlock'
    },

    /**
        Function: O.DomEvent.lookupKey

        Determines which key was pressed to generate the event supplied as an
        argument.

        Parameters:
            event       - {KeyEvent} The W3C DOM event object.
            noModifiers - Unless true, alt-/ctrl-/meta-/shift- will be prepended
                          to the returned value if the respective keys are held
                          down. They will always be in alphabetical order, e.g.
                          If the user pressed 'g' whilst holding down shift and
                          alt, the return value would be 'alt-shift-g'.

        Returns:
            {String} The key pressed (in lowercase if a letter).
    */
    lookupKey: function ( event, noModifiers ) {
        // See http://unixpapa.com/js/key.html. Short summary:
        // event.keyCode || event.which gives the ASCII code for any normal
        // keypress on all browsers. However, if event.which === 0 then it was a
        // special key and so it should be looked up in the table of function
        // keys. Anything from code 32 downwards must also be a special char.
        var code = event.keyCode || event.which,
            isKeyPress = ( event.type === 'keypress' ),
            preferAsci = isKeyPress && code > 32 &&
                event.which !== 0 && event.charCode !== 0,
            str = String.fromCharCode( code ).toLowerCase(),
            key = ( !preferAsci && DOMEvent.keys[ code ] ) || str,
            altAndShift;

        // Function keys
        if ( !preferAsci && 111 < code && code < 124 ) {
            key = 'f' + ( code - 111 );
        }
        // Append modifiers (use alphabetical order)
        var modifiers = '';
        if ( !noModifiers ) {
            // Different keyboard layouts may require Shift/Alt for non A-Z
            // keys, so we only add meta and ctrl modifiers.
            altAndShift = !isKeyPress || ( /[a-z]/.test( key ) );
            if ( event.altKey && altAndShift ) { modifiers += 'alt-'; }
            if ( event.ctrlKey ) { modifiers += 'ctrl-'; }
            if ( event.metaKey ) { modifiers += 'meta-'; }
            if ( event.shiftKey && altAndShift ) { modifiers += 'shift-'; }
        }

        return modifiers + key;
    }
};

NS.DOMEvent = DOMEvent;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Element.js                                                           \\
// Module: DOM                                                                \\
// Requires: Core, UA                                                         \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global Element, document */

/**
    Module: DOM

    The DOM module provides helper functions and classes for dealing with the
    DOM.
*/

( function ( NS, undefined ) {

/**
    Namespace: O.Element

    The O.Element namespace contains a number of helper functions for dealing
    with DOM elements.
*/

// Vars used to store references to fns so they can call each other.
var create, setStyle, setStyles, setAttributes, appendChildren, getPosition;

/**
    Property (private): Element-directProperties
    Type: Object

    Any names that match keys in this map will be set as direct properties
    rather than as attributes on the element.
*/
var directProperties = {
    'class': 'className',
    className: 'className',
    defaultValue: 'defaultValue',
    'for': 'htmlFor',
    html: 'innerHTML',
    text: 'textContent',
    unselectable: 'unselectable',
    value: 'value'
};

/**
    Property (private): Element-booleanProperties
    Type: Object

    Any names that match keys in this map will be set as direct properties and
    have their value converted to a boolean.
*/
var booleanProperties = {
    autofocus: 1,
    checked: 1,
    defaultChecked: 1,
    disabled: 1,
    hidden: 1,
    multiple: 1,
    readOnly: 1,
    required: 1,
    selected: 1
};

/**
    Method: Element#get

    Get a property or attribute of the element.

    Parameters:
        key - {String} The name of the property/attribute to get.

    Returns:
        {String|Boolean} The attribute or property.
*/
Element.prototype.get = function ( key ) {
    var prop = directProperties[ key ];
    return prop ?
        this[ prop ] :
    booleanProperties[ key ] ?
        !!this[ key ] :
        this.getAttribute( key );
};

/**
    Method: Element#set

    Sets a property or attribute on the element.

    Parameters:
        key   - {String} The name of the property/attribute to set.
        value - {String|Boolean} The value to set for that property.

    Returns:
        {Element} Returns self.
*/
Element.prototype.set = function ( key, value ) {
    var prop = directProperties[ key ],
        child;
    if ( prop ) {
        this[ prop ] = ( value == null ? '' : '' + value );
    } else if ( booleanProperties[ key ] ) {
        this[ key ] = !!value;
    } else if ( key === 'styles' ) {
        setStyles( this, value );
    } else if ( key === 'children' ) {
        while ( child = this.lastChild ) {
            this.removeChild( child );
        }
        appendChildren( this, value );
    } else if ( value == null ) {
        this.removeAttribute( key );
    } else {
        this.setAttribute( key, '' + value );
    }
    return this;
};

/**
    Property (private): Element-cssNoPx
    Type: Object

    Keys for CSS properties that take raw numbers as a value.
*/
var cssNoPx = {
    opacity: 1,
    zIndex: 1
};

/**
    Property (private): Element-styleNames
    Type: Object

    Map of normal CSS names to the name used on the style object.
*/
var styleNames = ( function () {
    var styles = NS.UA.cssProps,
        styleNames = {
            'float': document.body.style.cssFloat !== undefined ?
                'cssFloat' : 'styleFloat'
        },
        property, style;
    for ( property in styles ) {
        style = styles[ property ];
        if ( style ) {
            style = style.camelCase();
            // Stupid MS, don't follow convention.
            if ( style.slice( 0, 2 ) === 'Ms' ) {
                style = 'm' + style.slice( 1 );
            }
            styleNames[ property.camelCase() ] = style;
        }
    }
    return styleNames;
}() );

/**
    Property (private): O.Element-doc
    Type: Document

    A reference to the document object.
*/
var doc = document;

/**
    Property (private): O.Element-ieEventModel
    Type: Boolean

    Does the browser only support the IE event model?
*/
var ieEventModel = !!doc.addEventListener.isFake;

var DOCUMENT_POSITION_CONTAINED_BY = 16; // Node.DOCUMENT_POSITION_CONTAINED_BY;

var view = null;

NS.Element = {
    /**
        Function: O.Element.forView

        Sets the view to which newly created elements should be associated. This
        is used to associate bindings with a view and to add child views as
        subviews correctly. This is normally handled automatically by the render
        method in <O.View>, however should you need to use it manually it is
        important to store the previous view (returned by the method) and
        restore it when you are done creating elements for your view.

        Parameters:
            view - {(O.View|null)} The view to associate new/appended DOM
                   elements with.

        Returns:
            {(O.View|null)} The previous view DOM elements were associated with.
    */
    forView: function ( newView ) {
        var oldView = view;
        view = newView;
        return oldView;
    },

    /**
        Function: O.Element.create

        Creates and returns a new element, setting any supplied properties and
        appending any supplied children. If the browser event system doesn't
        support capturing (just IE<8), then this will also add an event listener
        for change and input events to any form elements.

        Parameters:
            tag      - {String} The tag name for the new class. You may also
                       specify class names and an id here using CSS syntax
                       (.class, #id). For example to create <span id="id"
                       class="class1 class2"></span> you could call:
                       O.Element.create('span#id.class1.class2');
            props    - {Object} (optional) The attributes to add to the element,
                       e.g. Element.create('input', { type: 'text' }); The
                       special attributes 'text' and 'html' allow you to set the
                       textual or html content of the element respectively.
            children - {(Element|String)[]} (optional) An array of child nodes
                       and/or strings of text to append to the element.
                       Text nodes will be created for each string supplied. Null
                       or undefined values will simply be skipped.

        Returns:
            {Element} The new element.
    */
    create: create = function ( tag, props, children ) {
        var i, l, parts, name, el;

        if ( props instanceof Array ) {
            children = props;
            props = null;
        }

        // Parse id/class names out of tag.
        if ( /[#.]/.test( tag ) ) {
            parts = tag.split( /([#.])/ );
            tag = parts[0];
            if ( !props ) { props = {}; }
            for ( i = 1, l = parts.length; i + 1 < l; i += 2 ) {
                name = parts[ i + 1 ];
                if ( parts[i] === '#' ) {
                    props.id = name;
                } else {
                    props.className = props.className ?
                        props.className + ' ' + name : name;
                }
            }
        }

        // Create element, set props and add children
        el = doc.createElement( tag );

        if ( ieEventModel && ( tag === 'input' ||
                tag === 'select' || tag === 'textarea' ) ) {
            el.addEventListener( tag === 'select' ?
                'change' : 'propertychange', NS.ViewEventsController, false );
        }
        if ( props ) {
            setAttributes( el, props );
        }
        if ( children ) {
            appendChildren( el, children );
        }
        return el;
    },

    /**
        Function: O.Element.setAttributes

        Sets each attribute in the object on the given element.

        Parameters:
            el    - {Element} The element to set the attributes on.
            props - {Object} The attributes to add to the element.
                    e.g. `Element.create('input', { type: 'text' });`
                    The special attributes `'text'` and `'html'` allow you to
                    set the textual or html content of the element respectively.

        Returns:
            {Element} The element.
    */
    setAttributes: setAttributes = function ( el, props ) {
        var prop, value;
        for ( prop in props ) {
            value = props[ prop ];
            if ( value !== undefined ) {
                if ( value instanceof NS.Binding ) {
                    value.to( prop, el ).connect();
                    if ( view ) { view.registerBinding( value ); }
                } else {
                    el.set( prop, value );
                }
            }
        }
        return el;
    },

    /**
        Function: O.Element.appendChildren

        Appends an array of children or views to an element

        Parameters:
            el       - {Element} The element to append to.
            children - {(Element|O.View)[]} The children to append.

        Returns:
            {Element} The element.
    */
    appendChildren: appendChildren = function ( el, children ) {
        if ( !( children instanceof Array ) ) { children = [ children ]; }
        var i, l, node;
        for ( i = 0, l = children.length; i < l; i += 1 ) {
            node = children[i];
            if ( node ) {
                if ( node instanceof Array ) {
                    appendChildren( el, node );
                }
                else if ( node instanceof NS.View ) {
                    view.insertView( node, el );
                } else {
                    if ( typeof node !== 'object' ) {
                        node = doc.createTextNode( node );
                    }
                    el.appendChild( node );
                }
            }
        }
        return el;
    },

    /**
        Function: O.Element.hasClass

        Determines if an element has a particular class name.

        Parameters:
            el        - {Element} The element to test.
            className - {String} The class name to check.

        Returns:
            {Boolean} Does the element have the class?
    */
    hasClass: function ( el, className ) {
        return el.className.contains( className, ' ' );
    },

    /**
        Function: O.Element.addClass

        Adds a class to the element if not already there.

        Parameters:
            el        - {Element} The element to add the class to.
            className - {String} The class name to add.

        Returns:
            {O.Element} Returns self.
    */
    addClass: function ( el, className ){
        var current = el.className;
        if ( !current.contains( className, ' ' ) ) {
            el.className = ( current ? current + ' ' : '' ) + className;
        }
        return this;
    },

    /**
        Function: O.Element.removeClass

        Removes a class from the element if present.

        Parameters:
            el        - {Element} The element to remove the class from.
            className - {String} The class name to remove.

        Returns:
            {O.Element} Returns self.
    */
    removeClass: function ( el, className ) {
        var current = el.className,
            index = (' ' + current + ' ' ).indexOf( ' ' + className + ' ' );
        if ( index > -1 ) {
            el.className = current.slice( 0, index && index - 1 ) +
                           current.slice( index + className.length );
        }
        return this;
    },

    /**
        Function: O.Element.setStyle

        Sets a CSS style on the element.

        Parameters:
            el    - {Element} The element to set the style on.
            style - {String} The name of the style to set.
            value - {(String|Number)} The value to set the style to.

        Returns:
            {O.Element} Returns self.
    */
    setStyle: setStyle = function ( el, style, value ) {
        if ( value !== undefined ) {
            style = style.camelCase();
            style = styleNames[ style ] || style;
            if ( typeof value === 'number' && !cssNoPx[ style ] ) {
                value += 'px';
            }
            // IE will throw an error if you try to set an invalid value for a
            // style.
            try {
                el.style[ style ] = value;
            } catch ( error ) {
                NS.RunLoop.didError({
                    name: 'Element#setStyle',
                    message: 'Invalid value set',
                    details:
                        'Style: ' + style +
                      '\nValue: ' + value +
                      '\nEl id: ' + el.id +
                      '\nEl class: ' + el.className
                });
            }
        }
        return this;
    },

    /**
        Function: O.Element.setStyles

        Set a collection of CSS styles on the element.

        Parameters:
            el    - {Element} The element to set the style on.
            styles - {Object} A map of styles->values to set.

        Returns:
            {O.Element} Returns self.
    */
    setStyles: setStyles = function ( el, styles ) {
        for ( var prop in styles ) {
            setStyle( el, prop, styles[ prop ] );
        }
        return this;
    },

    /**
        Function: O.Element.contains

        Tests whether one element is a descendent of or is the same node as
        another element.

        Parameters:
            el             - {Element} The element that might be the parent
                             element
            potentialChild - {Element} The element to test if it is the same as
                             or a descendent of the parent element.

        Returns:
            {Boolean} Is the second element equal to or a descendent of the
            first element?
    */
    contains: function ( el, potentialChild ) {
        var relation = el.compareDocumentPosition( potentialChild );
        return !relation || !!( relation & DOCUMENT_POSITION_CONTAINED_BY );
    },

    /**
        Function: O.Element.nearest

        Looks for the nearest element which is accepted by the test function or
        is of the element type given as the test string. The element given is
        tested first, then its parent, then its parent's parent etc.

        Parameters:
            el    - {Element} The element to start searching from.
            test  - {(String|Function)} If a function, this is called on each
                    successive element until one causes it to return a truthy
                    value. That element is then returned. If it is a string,
                    each element is instead checked to see if its nodeName is
                    the same as this string.
            limit - {Element} (optional) An element known to be higher in the
                    hierarchy than the desired element. If this is found in the
                    search path, a null result will be immediately be returned.

        Returns:
            {(Element|null)} The nearest matching element, or null if none
            matched.
    */
    nearest: function ( el, test, limit ) {
        if ( !limit ) { limit = el.ownerDocument.documentElement; }
        if ( typeof test === 'string' ) {
            var nodeName = test.toUpperCase();
            test = function ( el ) {
                return ( el.nodeName === nodeName );
            };
        }
        while ( el && !test( el ) ) {
            if ( !el || el === limit ) {
                return null;
            }
            el = el.parentNode;
        }
        return el;
    },

    /**
        Function: O.Element.getPosition

        Find the position of the top left corner of the element in pixels,
        relative either to the page as a whole or a supplied ancestor of the
        element.

        Parameters:
            el       - {Element} The element to determine the position of.
            ancestor - {Element} The top left corner of this element will be
                       treated as co-ordinates (0,0). This must be an ancestor
                       of the given element in the DOM tree.

        Returns:
            {Object} The offset in pixels of the element relative to the
            given ancestor or the whole page. Has two properties:
            `{ top: Number, left: Number }`.
    */
    getPosition: getPosition = function ( el, ancestor ) {
        var rect = el.getBoundingClientRect(),
            position = {
                top: rect.top,
                left: rect.left
            };
        if ( ancestor ) {
            rect = getPosition( ancestor );
            if ( ancestor.nodeName === 'BODY' ) {
                // document.documentElement - use of
                // body.scroll(Top|Left) is deprecated.
                ancestor = ancestor.parentNode;
            }
            position.top -= rect.top - ancestor.scrollTop;
            position.left -= rect.left - ancestor.scrollLeft;
        }
        return position;
    }
};

/**
    Function: Object.toCSSString

    Converts an object into a String of 'key:value' pairs, delimited by ';'.
    Keys are converted from camel case to hyphenated format and numerical
    values are converted to strings with a 'px' suffix.

    Parameters:
        object - {Object} The object of CSS properties.

    Returns:
        {String} The CSS string.
*/
Object.toCSSString = function ( object ) {
    var result = '',
        key, value;
    for ( key in object ) {
        value = object[ key ];
        if ( value !== undefined ) {
            if ( typeof value === 'number' && !cssNoPx[ key ] ) {
                value += 'px';
            }
            key = key.hyphenate();
            key = NS.UA.cssProps[ key ] || key;
            result += key;
            result += ':';
            result += value;
            result += ';';
        }
    }
    return result;
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Stylesheet.js                                                        \\
// Module: DOM                                                                \\
// Requires: Core, Element.js                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS ) {

/**
    Namespace: O.Stylesheet

    The O.Stylesheet namespace contains helper functions for dealing with CSS
    stylesheets.
*/
NS.Stylesheet = {
    /**
        Function: O.Stylesheet.create

        Injects CSS into the document by creating a new stylesheet and appending
        it to the document.

        Parameters:
            id  - {String} The id to give the node in the document.
            css - {String} The CSS to insert into the stylesheet.

        Returns:
            {Element} The <style> node that was created.
    */
    create: function ( id, css ) {
        var doc = document,
            head = doc.documentElement.firstChild,
            style = NS.Element.create( 'style', {
                type: 'text/css',
                id: id
            });

        if ( style.styleSheet ) {
            // IE8: must append to document BEFORE adding styles
            // or you get the IE7 CSS parser!
            head.appendChild( style );
            style.styleSheet.cssText = css;
        } else {
            // Everyone else
            style.appendChild( doc.createTextNode( css ) );
            head.appendChild( style );
        }
        return style;
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: GlobalKeyboardShortcuts.js                                           \\
// Module: Application                                                        \\
// Requires: Core, Foundation, UA                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var isMac = NS.UA.isMac;
var platformKeys = {
    alt: isMac ? '⌥' : 'Alt-',
    cmd: isMac ? '⌘' : 'Ctrl-',
    meta: isMac ? '⌘' : 'Meta-',
    shift: isMac ? '⇧' : 'Shift-',
    enter: isMac ? '↵' : 'Enter',
    backspace: isMac ? '⌫' : 'Backspace'
};

/**
    Function: O.formatKeyForPlatform

    Parameters:
        shortcut - {String} The keyboard shorcut, in the same format as
                   taken by <O.GlobalKeyboardShortcuts#register>.

    Returns:
        {String} The shortcut formatted for display on the user's platform.
*/
NS.formatKeyForPlatform = function ( shortcut ) {
    return shortcut.split( '-' ).map( function ( key ) {
        return platformKeys[ key ] || key.capitalise();
    }).join( '' );
};

var allowedInputs = {
    checkbox: 1,
    radio: 1,
    file: 1,
    submit: 1
};

var handleOnDown = {};

/**
    Class: O.GlobalKeyboardShortcuts

    Extends: O.Object

    This class facilitates adding keyboard shortcuts to your application.
*/
var GlobalKeyboardShortcuts = NS.Class({

    Extends: NS.Object,

    /**
        Property: O.GlobalKeyboardShortcuts#isEnabled
        Type: Boolean
        Default: true

        Callbacks will only fire if this property is true when the instance
        handles the event.
    */

    /**
        Property (private): O.GlobalKeyboardShortcuts#_shortcuts
        Type: Object

        The map of shortcut key to an array of `[object, method]` tuples.
    */

    /**
        Constructor: O.GlobalKeyboardShortcuts
    */
    init: function ( mixin ) {
        this.isEnabled = true;
        this._shortcuts = {};

        GlobalKeyboardShortcuts.parent.init.call( this, mixin );

        var ViewEventsController = NS.ViewEventsController;
        ViewEventsController.kbShortcuts = this;
        ViewEventsController.addEventTarget( this, -10 );
    },

    /**
        Method: O.GlobalKeyboardShortcuts#destroy

        Destructor.
    */
    destroy: function () {
        var ViewEventsController = NS.ViewEventsController;
        if ( ViewEventsController.kbShortcuts === this ) {
            delete NS.ViewEventsController.kbShortcuts;
        }
        ViewEventsController.removeEventTarget( this );
        GlobalKeyboardShortcuts.parent.destroy.call( this );
    },

    /**
        Method: O.GlobalKeyboardShortcuts#register

        Add a global keyboard shortcut. If a shortcut has already been
        registered for this key, it will be replaced, but will be restored when
        the new handler is removed.

        Parameters:
            key    - {String} The key to trigger the callback on. Modifier keys
                     (alt, ctrl, meta, shift) should be prefixed in alphabetical
                     order and with a hypen after each one. Letters should be
                     lower case. e.g. `ctrl-f`.

                     The special modifier "cmd-" may be used, which will map
                     to "meta-" on a Mac (the command key) and "Ctrl-"
                     elsewhere.
            object - {Object} The object to trigger the callback on.
            method - {String} The name of the method to trigger.

        Returns:
            {O.GlobalKeyboardShortcuts} Returns self.
    */
    register: function ( key, object, method ) {
        key = key.replace( 'cmd-', isMac ? 'meta-' : 'ctrl-' );
        var shortcuts = this._shortcuts;
        ( shortcuts[ key ] || ( shortcuts[ key ] = [] ) )
            .push([ object, method ]);
        return this;
    },

    /**
        Method: O.GlobalKeyboardShortcuts#deregister

        Remove a global keyboard shortcut. Must use identical arguments to those
        which were used in the call to <O.GlobalKeyboardShortcuts#register>.

        Parameters:
            key    - {String} The key on which the callback was triggered.
            object - {Object} The object on which the callback was triggered.
            method - {String} The name of the method that was being triggered.

        Returns:
            {O.GlobalKeyboardShortcuts} Returns self.
   */
    deregister: function ( key, object, method ) {
        key = key.replace( 'cmd-', isMac ? 'meta-' : 'ctrl-' );
        var current = this._shortcuts[ key ],
            length = current ? current.length : 0,
            l = length,
            item;
        while ( l-- ) {
            item = current[l];
            if ( item[0] === object && item[1] === method ) {
                if ( length === 1 ) {
                    delete this._shortcuts[ key ];
                } else {
                    current.splice( l, 1 );
                }
            }
        }
        return this;
    },

    /**
        Method: O.GlobalKeyboardShortcuts#getHandlerForKey

        Get the keyboard shortcut to be triggered by a key combo, represented as
        a string, as output by <O.DOMEvent#lookupKey>.

        Parameters:
            key - {String} The key combo to get the handler for.

        Returns:
            {Array|null} Returns the [ object, method ] tuple to be triggered by
            the event, or null if nothing is registered for this key press.
   */
    getHandlerForKey: function ( key ) {
        var shortcuts = this._shortcuts[ key ];
        if ( shortcuts && this.get( 'isEnabled' ) ) {
            return shortcuts[ shortcuts.length - 1 ];
        }
        return null;
    },

    /**
        Method: O.GlobalKeyboardShortcuts#trigger

        Keypress event handler. Triggers any registered callback.

        Parameters:
            event - {DOMEvent} The keydown/keypress event.
   */
    trigger: function ( event ) {
        var target = event.target,
            nodeName = target.nodeName,
            isSpecialKey = event.ctrlKey || event.metaKey,
            handler, key;
        if ( !isSpecialKey && ( nodeName === 'TEXTAREA' ||
                ( nodeName === 'SELECT' ) ||
                ( nodeName === 'INPUT' && !allowedInputs[ target.type ] ) ||
                ( event.targetView instanceof NS.RichTextView )
             ) ) {
            return;
        }
        key = NS.DOMEvent.lookupKey( event );
        if ( event.type === 'keydown' ) {
            handleOnDown[ key ] = true;
        } else if ( handleOnDown[ key ] ) {
            return;
        }
        handler = this.getHandlerForKey( key );
        if ( handler ) {
            handler[0][ handler[1] ]( event );
            if ( !event.doDefault ) {
                event.preventDefault();
            }
        }
    }.on( 'keydown', 'keypress' )
});

NS.GlobalKeyboardShortcuts = GlobalKeyboardShortcuts;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Router.js                                                            \\
// Module: Application                                                        \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document, window, history, location */

/**
    Module: Application

    The Application module contains classes for managing an HTML5 application.
*/

( function ( NS ) {

var getHash = function ( location ) {
    var href = location.href,
        i = href.indexOf( '#/' );
    return  i > -1 ? href.slice( i + 2 ) : '';
};
var getUrl = function ( location, base ) {
    return location.pathname.slice( base.length );
};
/**
    Class: O.Router

    Extends: O.Object

    This class adds the ability to manage the URL in the browser window,
    updating it when your application state changes and vice versa.
*/
var Router = NS.Class({

    Extends: NS.Object,

    /**
        Property: O.Router#title
        Type: String

        The last title for the page window.
    */
    title: document.title,

    /**
        Property: O.Router#currentPath
        Type: String

        The last URL set by the app.
    */
    currentPath: '',

    /**
        Property: O.Router#useHash
        Type: Boolean
        Default: True if supported

        If true, will use pushState to manipulate the real URL. If false, will
        just set the hash component instead. By default this is true if the
        browser supports pushState and false otherwise. If left as true,
        <O.Router#baseUrl> *must* be correctly configured.
    */
    useHash: !history.pushState || ( location.protocol === 'file:' ),

    /**
        Property: O.Router#baseUrl
        Type: String
        Default: "/"

        The path to the base of the URL space that maps to application state.
    */
    baseUrl: '/',

    /**
        Property: O.Router#encodedState
        Type: String

        The encoded version of your application's current state. Whenever this
        changes, the URL will automatically be updated to match, therefore it
        should not contain any characters which are illegal in URLS. It may be a
        computed property with dependencies or set manually when state changes.
    */
    encodedState: '',

    /**
        Property: O.Router#mayGoBack
        Type: Boolean
        Default: true

        If false, the router will ignore history events (hashchange or
        popstate).
    */
    mayGoBack: true,

    /**
        Property: O.Router#replaceState
        Type: Boolean
        Default: false

        If set to true, the next change of encodedState will cause the current
        history entry to be relaced, rather than appending a new history entry.
        The property will then automatically be set back to false. Set this to
        true if you decode an invalid URL path to ensure it doesn't remain in
        the browser history.
    */
    replaceState: false,

    /**
        Property: O.Router#routes
        Type: Array

        A collection of regular expressions for matching against URLs and
        functions for decoding the state from the match. Entries will be tried
        in order. Each entry should be an object with two properties:

        url    - {RegExp} The regular expression to execute on the encoded
                 state.
        handle - {Function} The handler for decoding the state if the regular
                 expression matches. This will be given the full encoded state
                 as the first parameter, followed by any capturing groups in the
                 regular expression.
    */
    routes: [],

    init: function ( mixin, win ) {
        Router.parent.init.call( this, mixin );
        if ( !win ) { win = window; }
        var location = win.location,
            path = ( this.useHash && getHash( location ) ) ||
                getUrl( location, this.baseUrl );
        this.set( 'currentPath', path );
        this.restoreStateFromUrl( path );
        win.addEventListener(
            this.useHash ? 'hashchange' : 'popstate', this, false );
        this._win = win;
    },

    /**
        Method: O.Router#setTitle

        Sets the window title. Called automatically whenever the
        <O.Router#title> property changes.
    */
    setTitle: function () {
        document.title = this.get( 'title' );
    }.observes( 'title' ),

    /**
        Method: O.Router#handleEvent

        Called automatically whenever the URL changes. Will compare to the last
        set value and if different, invoke <O.Router#restoreStateFromUrl> with
        the new URL.
    */
    handleEvent: function () {
        var location = this._win.location,
            path = this.useHash ?
                getHash( location ) : getUrl( location, this.baseUrl );

        if ( this.get( 'mayGoBack' ) && path !== this.get( 'currentPath' ) ) {
            this.set( 'currentPath', path );
            this.restoreStateFromUrl( path );
        }
    }.invokeInRunLoop(),

    /**
        Method: O.Router#restoreStateFromUrl

        Iterates throught the <O.Router#routes> until it finds a match, then
        uses that to decode the state from the URL. Called automatically
        whenever the URL changes.

        Parameters:
            url - {String} The url to restore state from.

        Returns:
            {O.Router} Returns self.
    */
    restoreStateFromUrl: function ( url ) {
        var routes = this.get( 'routes' ),
            i, l, route, match;

        for ( i = 0, l = routes.length; i < l; i += 1 ) {
            route = routes[i];
            if ( match = route.url.exec( url ) ) {
                this.beginPropertyChanges();
                route.handle.apply( this, match );
                this.endPropertyChanges();
                break;
            }
        }
        return this;
    },

    /**
        Method: O.Router#encodeStateToUrl

        Sets the current URL to match the <O.Router#encodedState> property.
        This method is called automatically once, at the end of the run loop,
        whenever this property changes.
    */
    encodeStateToUrl: function () {
        var state = this.get( 'encodedState' ),
            replaceState = this.get( 'replaceState' ),
            win = this._win,
            location, history, href, i, title, url;
        if ( this.get( 'currentPath' ) !== state ) {
            this.set( 'currentPath', state );
            if ( this.useHash ) {
                location = win.location;
                if ( replaceState ) {
                    href = location.href;
                    i = href.indexOf( '#' );
                    if ( i > -1 ) { href = href.slice( 0, i ); }
                    location.replace( href + '#/' + state );
                } else {
                    location.hash = '#/' + state;
                }
            } else {
                history = win.history;
                title = this.get( 'title' );
                url = this.getUrlForEncodedState( state );
                // Firefox sometimes throws an error for no good reason,
                // especially on replaceState, so wrap in a try/catch.
                try {
                    if ( replaceState ) {
                        history.replaceState( null, title, url );
                    } else {
                        history.pushState( null, title, url );
                    }
                } catch ( error ) {}
            }
            if ( replaceState ) {
                this.set( 'replaceState', false );
            }
        }
    }.queue( 'after' ).observes( 'encodedState' ),

    getUrlForEncodedState: function ( state ) {
        return this.get( 'baseUrl' ) + state;
    }
});

NS.Router = Router;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ThemeManager.js                                                      \\
// Module: Application                                                        \\
// Requires: Core, Foundation, DOM                                            \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS ) {

/**
    Class: O.ThemeManager

    Extends: O.Object

    The O.ThemeManager class manages the themes for an application. A theme
    consists of stylesheets and images. These can be loaded in stages and
    hotswapped if themes are changed.
*/
var ThemeManager = NS.Class({

    Extends: NS.Object,

    init: function ( mixin ) {
        this._images = { all: {} };
        this._styles = { all: {} };
        this._activeStylesheets = {};

        this.theme = '';

        ThemeManager.parent.init.call( this, mixin );
    },

    /**
        Property: O.ThemeManager#theme
        Type: String

        The name of the currently active theme.
    */

    /**
        Method: O.ThemeManager#changeTheme

        Replaces the stylesheets in the document from the old theme with
        equivalents from the new one.

        Parameters:
            oldTheme - {String} The name of the theme being deactivated.
            newTheme - {String} The name of the newly active theme.
    */
    changeTheme: function ( oldTheme, newTheme ) {
        var active = this._activeStylesheets,
            id;
        for ( id in active ) {
            if ( active[ id ] ) {
                this.addStylesheet( id, newTheme );
                this.removeStylesheet( id, oldTheme );
            }
        }
    },

    /**
        Method: O.ThemeManager#imageDidLoad

        Registers an image with the theme manager, making it available via
        <#getImageSrc> or in any stylesheets injected later into the page.

        Parameters:
            theme - {String} The name of the theme this image belongs to.
                    If applicable to all themes, use the string 'all'.
            id    - {String} An id for the image.
            data  - {String} The base64 encoded data for the image.
    */
    imageDidLoad: function ( theme, id, data ) {
        var themeImages = this._images[ theme ] ||
            ( this._images[ theme ] = {} );
        themeImages[ id ] = data;
        return this;
    },

    /**
        Method: O.ThemeManager#stylesheetDidLoad

        Registers an stylesheet with the theme manager, making it available to
        be injected by a call to <#addStylesheet>.

        Parameters:
            theme - {String} The name of the theme this image belongs to.
                    If applicable to all themes, use the string 'all'.
            id    - {String} An id for the image.
            data  - {String} The base64 encoded data for the image.
    */
    stylesheetDidLoad: function ( theme, id, data ) {
        var themeStyles = this._styles[ theme ] ||
            ( this._styles[ theme ] = {} );
        themeStyles[ id ] = data;
        return this;
    },

    /**
        Method: O.ThemeManager#addStylesheet

        Injects a new stylesheet into the page. Will first substitute in the
        data for all images it has loaded into memory.

        Parameters:
            id    - {String} The id to give the stylesheet.
            theme - {String} (optional) The theme to choose; defaults to the
                    currently set theme.

        Returns:
            {O.ThemeManager} Returns self.
    */
    addStylesheet: function ( id, theme ) {
        if ( !theme ) { theme = this.get( 'theme' ); }

        var styles = this._styles[ theme ],
            data = styles[ id ] || this._styles.all[ id ],
            images = this._images[ theme ] || {},
            themeIndependentImages = this._images.all,
            active = this._activeStylesheets;

        if ( data ) {
            // Substitute in images.
            data = data.replace( /url\(([^)]+)\)/g, function ( url, img ) {
                return 'url(' +
                    ( images[ img ] || themeIndependentImages[ img ] ||
                        NS.loc( img ) || img ) +
                ')';
            });
            NS.Stylesheet.create( theme + '-' + id, data );
            active[ id ] = ( active[ id ] || 0 ) + 1;
        }

        return this;
    },

    /**
        Method: O.ThemeManager#removeStylesheet

        Removes a previously added stylesheet from the page.

        Parameters:
            id   - {String} The id of the stylesheet to remove.

        Returns:
            {O.ThemeManager} Returns self.
    */
    removeStylesheet: function ( id, theme ) {
        if ( !theme ) { theme = this.get( 'theme' ); }

        var sheet = document.getElementById( theme + '-' + id );
        if ( sheet ) {
            sheet.parentNode.removeChild( sheet );
            this._activeStylesheets[ id ] -= 1;
        }

        return this;
    },

    /**
        Method: O.ThemeManager#getImageSrc

        Gets the (data) url for a loaded image.

        Parameters:
            id - {String} The id of the image.

        Returns:
            {(String|null)} A data URI for the requested image if the data is
            available, otherwise null.
    */
    getImageSrc: function ( id ) {
        var _images = this._images,
            themeImages = _images[ this.get( 'theme' ) ] || {},
            themeIndependentImages = _images.all;
        return themeImages[ id ] || themeIndependentImages[ id ] || null;
    }
});

NS.ThemeManager = ThemeManager;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: WindowController.js                                                  \\
// Module: Application                                                        \\
// Requires: Core, Foundation, UA                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global window, document, localStorage */

( function ( NS, window, document, localStorage ) {

/**
    Class: O.WindowController

    Extends: O.Object

    If your application is open in multiple browser windows/tabs, you may want
    to coordinate behaviour between them, but you can't get a direct reference
    to a window you didn't explicitly open. This class allows you to broadcast
    messages to other tabs open in the same domain, so you can still coordinate
    behaviour. In particular, if you use push events in your application, you
    probably want only one tab to actually hold a permanent connection to the
    push server. Browsers limit the maximum number of simultaneous connections
    to the same server, so if you have (say) 6 tabs open, all of the allowed
    connections could be taken up with push connections which are never
    released, so your application cannot perform any other I/O and will appear
    to mysteriously fail.

    The WindowController class automatically coordinates between windows to
    elect a single tab to be "master". You can connect just this one to your
    push server, then broadcast any push events received to the other tabs via
    this controller as well. It also monitors whether the window currently has
    focus or not.
*/
var WindowController = NS.Class({

    Extends: NS.Object,

    /**
        Property: O.WindowController#broadcastKey
        Type: String
        Default: "owm:broadcast"

        The key to use for the local storage property that will be set to
        broadcast messages to other tabs.
    */
    broadcastKey: 'owm:broadcast',

    /**
        Property: O.WindowController#isMaster
        Type: Boolean

        Is this tab/window the elected "master"? If multiple windows with the
        application are open, they will coordinate between themselves so only
        one has the isMaster property set to true. Note, in some circumstances,
        this may not happen instantly and there may be a short while when there
        is no master or more than one master. However, it will quickly resolve
        itself.
    */

    /**
        Property: O.WindowController#isFocussed
        Type: Boolean

        Is the tab/window currently focussed?
    */

    /**
        Property: O.WindowController#id
        Type: String

        A unique id for the window, guaranteed to be different than for any
        other open window.
    */

    init: function ( mixin ) {
        this.id = new Date().format( '%y%m%d%H%M%S' ) + Math.random();
        this.isMaster = false;
        this.isFocussed = ( NS.UA.msie !== 8 && document.hasFocus ) ?
            document.hasFocus() : true;
        this._seenWCs = {};

        WindowController.parent.init.call( this, mixin );

        window.addEventListener( 'storage', this, false );
        window.addEventListener( 'unload', this, false );
        window.addEventListener( 'focus', this, false );
        window.addEventListener( 'blur', this, false );

        this.broadcast( 'wc:hello' );

        var RunLoop = NS.RunLoop;

        var that = this;
        var check = function check () {
            that.checkMaster();
            that._checkTimeout = RunLoop.invokeAfterDelay( check, 9000 );
        };
        var ping = function ping () {
            that.sendPing();
            that._pingTimeout = RunLoop.invokeAfterDelay( ping, 17000 );
        };
        this._checkTimeout = RunLoop.invokeAfterDelay( check, 500 );
        this._pingTimeout = RunLoop.invokeAfterDelay( ping, 17000 );
    },

    destroy: function () {
        NS.RunLoop.cancel( this._pingTimeout )
                  .cancel( this._checkTimeout );

        window.removeEventListener( 'storage', this, false );
        window.removeEventListener( 'unload', this, false );
        window.removeEventListener( 'focus', this, false );
        window.removeEventListener( 'blur', this, false );

        this.broadcast( 'wc:bye' );

        WindowController.parent.destroy.call( this );
    },

    /**
        Method (protected): O.WindowController#handleEvent

        Handles storage, unload, focus and blur events.

        Parameters:
            event - {Event} The event object.
    */
    handleEvent: function ( event ) {
        switch( event.type ) {
        case 'storage':
            if ( event.key === this.get( 'broadcastKey' ) ) {
                try {
                    var data = JSON.parse( event.newValue );
                    // IE fires events in the same window that set the
                    // property. Ignore these.
                    if ( data.wcId !== this.id ) {
                        this.fire( data.type, data );
                    }
                } catch ( error ) {}
            }
            break;
        case 'unload':
            this.destroy();
            break;
        case 'focus':
            this.set( 'isFocussed', true );
            break;
        case 'blur':
            this.set( 'isFocussed', false );
            break;
        }
    }.invokeInRunLoop(),


    /**
        Method (protected): O.WindowController#sendPing

        Sends a ping to let other windows know about the existence of this one.
        Automatically called periodically.
    */
    sendPing: function () {
        this.broadcast( 'wc:ping' );
    },

    /**
        Method (private): O.WindowController#_hello

        Handles the arrival of a new window.

        Parameters:
            event - {Event} An event object containing the window id.
    */
    _hello: function ( event ) {
        this._ping( event );
        if ( event.wcId < this.id ) {
            this.checkMaster();
        } else {
            this.sendPing();
        }
    }.on( 'wc:hello' ),

    /**
        Method (private): O.WindowController#_ping

        Handles a ping from another window.

        Parameters:
            event - {Event} An event object containing the window id.
    */
    _ping: function ( event ) {
        this._seenWCs[ event.wcId ] = Date.now();
    }.on( 'wc:ping' ),


    /**
        Method (private): O.WindowController#_bye

        Handles the departure of another window.

        Parameters:
            event - {Event} An event object containing the window id.
    */
    _bye: function ( event ) {
        delete this._seenWCs[ event.wcId ];
        this.checkMaster();
    }.on( 'wc:bye' ),

    /**
        Method: O.WindowController#checkMaster

        Looks at the set of other windows it knows about and sets the isMaster
        property based on whether this window has the lowest ordered id.
    */
    checkMaster: function () {
        var now = Date.now(),
            isMaster = true,
            seenWCs = this._seenWCs,
            ourId = this.id,
            id;
        for ( id in seenWCs ) {
            if ( seenWCs[ id ] + 23000 < now ) {
                delete seenWCs[ id ];
            } else if ( id < ourId ) {
                isMaster = false;
            }
        }
        this.set( 'isMaster', isMaster );
    },

    /**
        Method: O.WindowController#broadcast

        Broadcast an event with JSON-serialisable data to other tabs.

        Parameters:
            type - {String} The name of the event being broadcast.
            data - {Object} (optional). The data to broadcast.
    */
    broadcast: function ( type, data ) {
        try {
            localStorage.setItem(
                this.get( 'broadcastKey' ),
                JSON.stringify( NS.extend({
                    wcId: this.id,
                    type: type
                }, data ))
            );
        } catch ( error ) {}
    }
});

NS.WindowController = WindowController;

}( O, window, document, localStorage ) );


// -------------------------------------------------------------------------- \\
// File: Status.js                                                            \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/**
    Enum: O.Status

    EMPTY        - The record has no data loaded.
    READY        - The record has data loaded and may be used.
    DESTROYED    - The record is destroyed.
    NON_EXISTENT - No record of this type with this id exists in the source.
    LOADING      - A request for the record's data is in progress.
    COMMITTING   - Changes are currently being committed to the source.
    NEW          - The record is new and has not been committed to the source.
    DIRTY        - Changes have been made to the record which have not yet been
                   committed to the source.
    OBSOLETE     - Changes may have been made to the record in the source which
                   have not yet been fetched. If the record is loading, this
                   means the result of the load may not be the latest.
*/
O.Status = {
    // Core states:
    EMPTY:        1,
    READY:        2,
    DESTROYED:    4,
    NON_EXISTENT: 8,

    // Properties:
    LOADING:     16,
    COMMITTING:  32,
    NEW:         64,
    DIRTY:      128,
    OBSOLETE:   256
};


// -------------------------------------------------------------------------- \\
// File: LiveQuery.js                                                         \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Status.js                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var Status = NS.Status,
    READY = Status.READY,
    DESTROYED = Status.DESTROYED;

var numerically = function ( a, b ) {
    return a - b;
};

/**
    Class: O.LiveQuery

    Extends: O.Object

    Includes: O.ObserverableRange, O.Enumerable

    A LiveQuery instance can be treated as an observable array which
    automatically updates its contents to reflect a certain query on the store.
    A query consists of a particular type, a filter function and a sort order.
    Normally you will not create a LiveQuery instance yourself but get it by
    retrieving the query from the store.
 */
var LiveQuery = NS.Class({

    Extends: NS.Object,

    Mixin: [ NS.ObservableRange, NS.Enumerable ],

    /**
        Property: O.LiveQuery#id
        Type: String

        A unique identifier for this query.
    */
    id: function () {
        return NS.guid( this );
    }.property().nocache(),

    /**
        Property (private): O.LiveQuery#_filter
        Type: (Function|null)

        The function to filter data objects with.
    */

    /**
        Property (private): O.LiveQuery#_sort
        Type: (Function|null)

        The function to sort the data objects with.
    */

    /**
        Property: O.LiveQuery#store
        Type: O.Store

        The store to query for records.
    */

    /**
        Property: O.LiveQuery#Type
        Type: O.Class

        The Record class constructor function for the type of the instances to
        include in this query.
    */

    /**
        Property: O.LiveQuery#status
        Type: O.Status

        Status of the query: READY|DESTROYED
    */

    /**
        Constructor: O.LiveQuery

        The following properties should be configured:

        store  - {O.Store} The store to query for records.
        Type   - {O.Class} The constructor for the record type this query is a
                 collection of.
        filter - {Function} (optional) If supplied, only records which this
                 function returns a truthy value for are included in the
                 results.
        sort   - {(String|String[]|Function)} (optional) The records in
                 the local query are sorted according to this named property. If
                 an array is supplied, in the case of a tie the next property in
                 the array will be consulted. If a function is supplied, this is
                 used as the sort function directly on the records. If nothing
                 is supplied, the results are not guaranteed to be in any
                 particular order.

        Parameters:
            mixin - {Object} The properties for the query.
    */
    init: function ( mixin ) {
        var Type = mixin.Type,
            sort = mixin.sort,
            store = mixin.store || this.store,
            results;

        if ( sort && !( sort instanceof Function ) ) {
            sort = mixin.sort = NS.sortByProperties( sort );
        }
        results = store.findAll( Type, mixin.filter, sort );

        this._storeKeys = results;
        this._sort = results.sortFn;
        this._filter = results.filterFn;

        this.status = store.getTypeStatus( Type ) & READY;

        this.length = results.length;

        LiveQuery.parent.init.call( this, mixin );

        store.addQuery( this );
    },

    /**
        Method: O.LiveQuery#destroy

        Call this method when you have finished with a local query to ensure it
        does not continue monitoring the store for changes and can be garbage
        collected.
    */
    destroy: function () {
        this.set( 'status', DESTROYED );
        this.get( 'store' ).removeQuery( this );
        LiveQuery.parent.destroy.call( this );
    },

    /**
        Method: O.LiveQuery#is

        Checks whether the query has a particular status.

        Parameters:
            status - {O.Status} The status to check.

        Returns:
            {Boolean} True if the record has the queried status.
    */
    is: function ( status ) {
        return !!( this.get( 'status' ) & status );
    },

    /**
        Property: O.LiveQuery#[]
        Type: Array

        A standard array of record objects for the records in this query.
    */
    '[]': function () {
        var store = this.get( 'store' ),
            Type = this.get( 'Type' );
        return this._storeKeys.map( function ( storeKey ) {
            return store.materialiseRecord( storeKey, Type );
        });
    }.property().nocache(),

    /**
        Property: O.LiveQuery#length
        Type: Number

        The number of records in the query.
    */

    /**
        Method: O.LiveQuery#indexOfId

        Finds the index of an id in the query. If the id is not found, the index
        returned will be -1.

        Parameters:
            id       - {String} The record id to find.
            from     - {Number} The first index to start the search from.
                       Specify 0 to search the whole list.
            callback - {Function} (optional) A callback to make with the id. For
                       compatibility with <O.RemoteQuery>.

        Returns:
            {Number} The index of the id, or -1 if not found.
    */
    indexOfId: function ( id, from, callback ) {
        var record = this.get( 'store' ).getRecord( this.get( 'Type' ), id ),
            index = -1,
            storeKey;

        if ( record.is( READY ) ) {
            storeKey = record.get( 'storeKey' );
            index = this._storeKeys.indexOf( storeKey, from );
        }
        if ( callback ) {
            callback( index );
        }
        return index;
    },

    /**
        Method: O.LiveQuery#getObjectAt

        Returns the record at the index given in the query.

        Parameters:
            index - {Number} The index of the record to return.

        Returns:
            {O.Record} The record at index i in this array.
    */
    getObjectAt: function ( index ) {
        var storeKey = this._storeKeys[ index ],
            record;
        if ( storeKey ) {
            record = this.get( 'store' )
                         .materialiseRecord( storeKey, this.get( 'Type' ) );
        }
        return record;
    },

    /**
        Method: O.LiveQuery#refresh

        Asks the store to refresh the data for the type used in this query.

        Parameters:
            force - {Boolean} (optional) If true, the store will refresh the
                    data even if it thinks it is up to date.

        Returns:
            {O.LiveQuery} Returns self.
    */
    refresh: function ( force ) {
        this.get( 'store' ).fetchAll( this.get( 'Type' ), force );
        return this;
    },

    /**
        Method: O.LiveQuery#reset

        Recalculate the set of matching results.

        Returns:
            {O.LiveQuery} Returns self.
    */
    reset: function () {
        var oldStoreKeys = this._storeKeys,
            storeKeys = this.get( 'store' ).findAll(
                this.get( 'Type' ), this.filter, this.sort ),
            maxLength = Math.max( storeKeys.length, oldStoreKeys.length );

        this._storeKeys = storeKeys;

        return this
            .beginPropertyChanges()
                .set( 'length', storeKeys.length )
                .rangeDidChange( 0, maxLength )
            .endPropertyChanges()
            .fire( 'query:reset' );
    },

    /**
        Method: O.LiveQuery#storeDidChangeRecords

        Callback made by the store when there are changes that affect the query.
        The query calculate the changes to make and fire any necessary
        observers/events.

        Parameters:
            storeKeysOfChanged - {Array} List of store keys that have changed
                                 which are of the type included in this query.

        Returns:
            {Boolean} Was there a change in the query results?
    */
    storeDidChangeRecords: function ( storeKeysOfChanged ) {
        var filter = this._filter,
            sort = this._sort,
            storeKeys = this._storeKeys,
            added = [], addedIndexes = [],
            removed = [], removedIndexes = [],
            oldLength = this.get( 'length' ),
            store = this.get( 'store' ),
            storeKeyToId = function ( storeKey ) {
                return store.getIdFromStoreKey( storeKey ) ||
                    ( '#' + storeKey );
            },
            i, l, storeKey, index, shouldBeInQuery,
            newStoreKeys, oi, ri, ai, a, b,
            addedLength, removedLength, newLength, maxLength;

        // 1. Find indexes of removed and ids of added
        // If it's changed, it's added to both.
        l = storeKeysOfChanged.length;
        while ( l-- ) {
            storeKey = storeKeysOfChanged[l];
            index = storeKeys.indexOf( storeKey );
            shouldBeInQuery = ( store.getStatus( storeKey ) & READY ) &&
                ( !filter || filter( storeKey ) );
            // If in query
            if ( index > -1 ) {
                // And should be in query
                if ( shouldBeInQuery ) {
                    // If there's a sort
                    if ( sort ) {
                        removedIndexes.push( index );
                        added.push( storeKey );
                    }
                }
                // And shouldn't be in query
                else {
                    removedIndexes.push( index );
                }
            }
            // If not in query
            else {
                // But should be
                if ( shouldBeInQuery ) {
                    added.push( storeKey );
                }
            }
        }

        removedLength = removedIndexes.length;
        addedLength = added.length;

        // 2. Sort removed indexes and find removed ids.
        if ( removedLength ) {
            removedIndexes.sort( numerically );
            for ( i = 0; i < removedLength; i += 1 ) {
                removed[i] = storeKeys[ removedIndexes[i] ];
            }
        }

        // 3. Construct new array of store keys by merging sorted arrays
        if ( addedLength || removedLength ) {
            if ( addedLength && sort ) {
                added.sort( sort );
            }
            newLength = oldLength - removedLength + addedLength;
            newStoreKeys = new Array( newLength );
            for ( i = 0, oi = 0, ri = 0, ai = 0; i < newLength; i += 1 ) {
                while ( ri < removedLength && oi === removedIndexes[ ri ] ) {
                    ri += 1;
                    oi += 1;
                }
                if ( sort && oi < oldLength && ai < addedLength ) {
                    a = storeKeys[ oi ];
                    b = added[ ai ];
                    if ( sort( a, b ) < 0 ) {
                        newStoreKeys[i] = a;
                        oi += 1;
                    } else {
                        newStoreKeys[i] = b;
                        addedIndexes[ ai ] = i;
                        ai += 1;
                    }
                } else if ( oi < oldLength ) {
                    newStoreKeys[i] = storeKeys[ oi ];
                    oi += 1;
                } else {
                    newStoreKeys[i] = added[ ai ];
                    addedIndexes[ ai ] = i;
                    ai += 1;
                }
            }
        }

        // 4. Sort added/addedIndexes arrays by index
        if ( addedLength ) {
            addedIndexes.sort( numerically );
            for ( i = 0; i < addedLength; i += 1 ) {
                added[i] = newStoreKeys[ addedIndexes[i] ];
            }
        }

        // 5. Check if there are any redundant entries in the added/removed
        // lists
        l = Math.min( addedLength, removedLength );
        while ( l-- ) {
            if ( added[l] === removed[l] &&
                    addedIndexes[l] === removedIndexes[l] ) {
                added.splice( l, 1 );
                addedIndexes.splice( l, 1 );
                removed.splice( l, 1 );
                removedIndexes.splice( l, 1 );
                addedLength -= 1;
                removedLength -= 1;
            }
        }

        // 6. If there was an actual change, notify observers.
        if ( addedLength || removedLength ) {
            this._storeKeys = newStoreKeys;
            maxLength = Math.max( newLength, oldLength );
            this.beginPropertyChanges()
                .set( 'length', newLength )
                .rangeDidChange(
                    Math.min(
                        addedLength ? addedIndexes[0] : maxLength,
                        removedLength ? removedIndexes[0] : maxLength
                    ),
                    newLength === oldLength ?
                        Math.max(
                            addedLength ?
                                addedIndexes[ addedLength - 1 ] : 0,
                            removedLength ?
                                removedIndexes[ removedLength - 1 ] : 0
                        ) + 1 :
                        maxLength
                )
                .endPropertyChanges()
                .fire( 'query:updated', {
                    removed: removed.map( storeKeyToId ),
                    removedIndexes: removedIndexes,
                    added: added.map( storeKeyToId ),
                    addedIndexes: addedIndexes
                });
            return true;
        }
        return false;
    },

    /**
        Method: O.LiveQuery#getIdsForObjectsInRange

        Get a callback with an array of the id properties for all objects in the
        range given.

        Parameters:
            start    - {Number} The index of the first object to get an id for.
            end      - {Number} One past the index of the last object to get an
                       id for.
            callback - {Function} This will be called with the array of ids as
                       the first argument, the index of the first returned
                       result as the second argument, and one past the index
                       of the last result as the third argument.

        Returns:
            {Boolean} Always false. Represents whether the data is still loading
            (i.e. whether the callback has yet to be fired).
    */
    getIdsForObjectsInRange: function ( start, end, callback ) {
        start = Math.max( 0, start );
        end = Math.min( this.get( 'length' ), end );
        var store = this.get( 'store' );
        callback( this._storeKeys.slice( start, end )
                                 .map( function ( storeKey ) {
            return store.getIdFromStoreKey( storeKey ) || ( '#' + storeKey );
        }), start, end );
        return false;
    },

    /**
        Method: O.LiveQuery#getIdsForAllObjects

        Get a callback with an array of the id properties for all objects in the
        array.

        Parameters:
            callback - {Function} This will be called with the array of ids as
                       the first argument, the index of the first returned
                       result as the second argument, and one past the index
                       of the last result as the third argument.

        Returns:
            {Boolean} Always false. Represents whether the data is still loading
            (i.e. whether the callback has yet to be fired).
    */
    getIdsForAllObjects: function ( callback ) {
        // 0x7fffffff is the largest positive signed 32-bit number.
        return this.getIdsForObjectsInRange( 0, 0x7fffffff, callback );
    }
});

NS.LiveQuery = LiveQuery;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RecordArray.js                                                       \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.RecordArray

    Extends: O.Object

    Includes: O.Enumerable

    An immutable enumerable object representing a list of records.
 */
var RecordArray = NS.Class({

    Extends: NS.Object,

    Mixin: NS.Enumerable,

    init: function ( store, Type, storeKeys ) {
        this.store = store;
        this.Type = Type;
        this.storeKeys = storeKeys;

        RecordArray.parent.init.call( this );
    },

    /**
        Property: O.RecordArray#length
        Type: Number

        The number of records in the array.
    */
    length: function () {
        return this.get( 'storeKeys' ).length;
    }.property( 'storeKeys' ),

    /**
        Method: O.RecordArray#getObjectAt

        Returns the record at the index given in the array.

        Parameters:
            index - {Number} The index of the record to return.

        Returns:
            {O.Record} The record at index i in this array.
    */
    getObjectAt: function ( index ) {
        var storeKey = this.get( 'storeKeys' )[ index ],
            record;
        if ( storeKey ) {
            record = this.get( 'store' )
                         .materialiseRecord( storeKey, this.get( 'Type' ) );
        }
        return record;
    }
});

NS.RecordArray = RecordArray;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Record.js                                                            \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Status.js                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.Record-AttributeErrors

    Extends: O.Object

    Maintains the state of the validity of each attribute on a record.
*/
var AttributeErrors = NS.Class({

    Extends: NS.Object,

    /**
        Property: O.Record-AttributeErrors#errorCount
        Type: Number

        The number of attributes on the record in an error state.
    */

    /**
        Constructor: O.Record-AttributeErrors

        Parameters:
            record - {O.Record} The record to manage attribute errors for.
    */
    init: function ( record ) {
        AttributeErrors.parent.init.call( this );

        var attrs = NS.meta( record ).attrs,
            metadata = NS.meta( this ),
            dependents = metadata.dependents = NS.clone( metadata.dependents ),
            errorCount = 0,
            attrKey, propKey, attribute, error, dependencies, l, key;

        for ( attrKey in attrs ) {
            // Check if attribute has been removed (e.g. in a subclass).
            if ( propKey = attrs[ attrKey ] ) {
                // Validate current value and set error on this object.
                attribute = record[ propKey ];
                error = this[ propKey ] = attribute.validate ?
                  attribute.validate( record.get( propKey ), propKey, record ) :
                  null;

                // Keep an error count
                if ( error ) { errorCount += 1; }

                // Add observers for validity dependencies.
                dependencies = attribute.validityDependencies;
                if ( dependencies ) {
                    l = dependencies.length;
                    while ( l-- ) {
                        key = dependencies[l];
                        if ( !dependents[ key ] ) {
                            dependents[ key ] = [];
                            record.addObserverForKey(
                                key, this, 'attrDidChange' );
                        }
                        dependents[ key ].push( propKey );
                    }
                }
            }
        }

        this.errorCount = errorCount;
        this._record = record;
    },

    /**
        Method: O.Record-AttributeErrors#attrDidChange

        Called when an attribute changes on the record for which another
        attribute has a validity dependency.

        Parameters:
            _    - {*} Unused.
            attr - {String} The name of the attribute which has changed.
    */
    attrDidChange: function ( _, attr ) {
        var metadata = NS.meta( this ),
            changed = metadata.changed = {},
            dependents = metadata.dependents[ attr ],
            l = dependents.length,
            record = this._record,
            propKey, attribute;

        this.beginPropertyChanges();
        while ( l-- ) {
            propKey = dependents[l];
            attribute = record[ propKey ];
            changed[ propKey ] = {
                oldValue: this[ propKey ],
                newValue: this[ propKey ] = ( attribute.validate ?
                  attribute.validate( record.get( propKey ), propKey, record ) :
                  null )
            };
        }
        this.endPropertyChanges();
    },

    /**
        Method: O.Record-AttributeErrors#setRecordValidity

        Updates the internal count of how many attributes are invalid and sets
        the <O.Record#isValid> property. Called automatically whenever a
        validity error string changes.

        Parameters:
            _       - {*} Unused.
            changed - {Object} A map of validity string changes.
    */
    setRecordValidity: function ( _, changed ) {
        var errorCount = this.get( 'errorCount' ),
            key, vals, wasValid, isValid;
        for ( key in changed ) {
            if ( key !== 'errorCount' ) {
                vals = changed[ key ];
                wasValid = !vals.oldValue;
                isValid = !vals.newValue;
                if ( wasValid && !isValid ) {
                    errorCount += 1;
                }
                else if ( isValid && !wasValid ) {
                    errorCount -= 1;
                }
            }
        }
        this.set( 'errorCount', errorCount )
            ._record.set( 'isValid', !errorCount );
    }.observes( '*' )
});

var Status = NS.Status;
var READY_NEW_DIRTY = (Status.READY|Status.NEW|Status.DIRTY);

/**
    Class: O.Record

    Extends: O.Object

    All data object classes managed by the store must inherit from Record. This
    provides the basic status management for the attributes.
*/
var Record = NS.Class({

    Extends: NS.Object,

    /**
        Constructor: O.Record

        Parameters:
            store    - {Store} The store to link to this record.
            storeKey - {String} (optional) The unique id for this record in the
                       store. If ommitted, a new record will be created, which
                       can then be committed to the store using the
                       <O.Record#saveToStore> method.
    */
    init: function ( store, storeKey ) {
        this._noSync = false;
        this._data = storeKey ? null : {};
        this.store = store;
        this.storeKey = storeKey;

        Record.parent.init.call( this );
    },

    /**
        Property: O.Record#store
        Type: O.Store

        The store this record is associated with.
    */

    /**
        Property: O.Record#storeKey
        Type: (String|undefined)

        The record store key; will be unique amonsgst all loaded records, even
        across those of different types.
    */

    /**
        Property: O.Record#status
        Type: O.Status

        The status of this Record. A Record goes through three primary phases:
        EMPTY -> READY -> DESTROYED. Alternatively it may go EMPTY ->
        NON_EXISTENT. Whilst in these phases it may acquire other properties:
        LOADING, NEW, DIRTY, OBSOLETE. Each of the primary phases as well as the
        secondary properties are different bits in the status bitarray. You
        should check the condition by using bitwise operators with the constants
        defined in <O.Status>.
    */
    status: function () {
        var storeKey = this.get( 'storeKey' );
        return storeKey ?
            this.get( 'store' ).getStatus( storeKey ) :
            READY_NEW_DIRTY;
    }.property().nocache(),

    /**
        Method: O.Record#is

        Checks whether record has a particular status. You can also supply a
        union of statuses (e.g. `record.is(O.Status.OBSOLETE|O.Status.DIRTY)`),
        in which case it will return true if the record has *any* of these
        status bits set.

        Parameters:
            state - {O.Status} The status to check.

        Returns:
            {Boolean} True if the record has the queried status.
    */
    is: function ( state ) {
        return !!( this.get( 'status' ) & state );
    },

    /**
        Method: O.Record#setObsolete

        Adds <O.Status.OBSOLETE> to the current status value.

        Returns:
            {O.Record} Returns self.
    */
    setObsolete: function () {
        var storeKey = this.get( 'storeKey' ),
            status = this.get( 'status' );
        if ( storeKey ) {
            this.get( 'store' ).setStatus( storeKey, status | Status.OBSOLETE );
        }
        return this;
    },

    /**
        Method: O.Record#setLoading

        Adds <O.Status.LOADING> to the current status value.

        Returns:
            {O.Record} Returns self.
    */
    setLoading: function () {
        var storeKey = this.get( 'storeKey' ),
            status = this.get( 'status' );
        if ( storeKey ) {
            this.get( 'store' ).setStatus( storeKey, status | Status.LOADING );
        }
        return this;
    },

    /**
        Property: O.Record#id
        Type: String

        The record id. It's fine to override this with an attribute, provided it
        is the primary key. If the primary key for the record is not called
        'id', you must not override this property.
    */
    id: function () {
        var storeKey = this.get( 'storeKey' );
        return storeKey ?
            this.get( 'store' ).getIdFromStoreKey( storeKey ) :
            this.get( this.constructor.primaryKey );
    }.property(),

    toJSON: function () {
        return this.get( 'storeKey' );
    },

    toIdOrStoreKey: function () {
        return this.get( 'id' ) || ( '#' + this.get( 'storeKey' ) );
    },

    /**
        Method: O.Record#saveToStore

        Saves the record to the store. Will then be committed back by the store
        according to the store's policy. Note, only a record not currently
        created in its store can do this; an error will be thrown if this method
        is called for a record already created in the store.

        Returns:
            {O.Record} Returns self.
    */
    saveToStore: function () {
        if ( this.get( 'storeKey' ) ) {
            throw new Error( "Record already created in store." );
        }
        var Type = this.constructor,
            data = this._data,
            store = this.get( 'store' ),
            idPropKey = Type.primaryKey || 'id',
            idAttrKey = this[ idPropKey ].key || idPropKey,
            storeKey = store.getStoreKey( Type, data[ idAttrKey ] ),
            attrs = NS.meta( this ).attrs,
            attrKey, propKey, attribute, defaultValue;

        this._data = null;

        // Fill in any missing defaults
        for ( attrKey in attrs ) {
            propKey = attrs[ attrKey ];
            if ( propKey ) {
                attribute = this[ propKey ];
                if ( !( attrKey in data ) && !attribute.noSync ) {
                    defaultValue = attribute.defaultValue;
                    if ( defaultValue !== undefined ) {
                        data[ attrKey ] = defaultValue && defaultValue.toJSON ?
                            defaultValue.toJSON() : NS.clone( defaultValue );
                    }
                }
            }
        }

        // Save to store
        store.createRecord( storeKey, data )
             .setRecordForStoreKey( storeKey, this )
             .fire( 'record:user:create', { record: this } );

        // And save store reference on record instance.
        return this.set( 'storeKey', storeKey );
    },

    /**
        Method: O.Record#discardChanges

        Reverts the attributes in the record to the last committed state. If
        the record has never been committed, this will destroy the record.

        Returns:
            {O.Record} Returns self.
    */
    discardChanges: function () {
        if ( this.get( 'status' ) === READY_NEW_DIRTY ) {
            this.destroy();
        } else {
            var storeKey = this.get( 'storeKey' );
            if ( storeKey ) {
                this.get( 'store' ).revertData( storeKey );
            }
        }
        return this;
    },

    /**
        Method: O.Record#refresh

        Fetch/refetch the data from the source. Will have no effect if the
        record is new or already loading.

        Returns:
            {O.Record} Returns self.
    */
    refresh: function () {
        var storeKey = this.get( 'storeKey' );
        if ( storeKey ) { this.get( 'store' ).fetchData( storeKey ); }
        return this;
    },

    /**
        Method: O.Record#destroy

        Destroy the record. This will inform the store, which will commit it to
        the source.
    */
    destroy: function () {
        var storeKey = this.get( 'storeKey' );
        if ( storeKey && this.get( 'isEditable' ) ) {
            this.get( 'store' )
                .fire( 'record:user:destroy', { record: this } )
                .destroyRecord( storeKey );
        }
    },

    /**
        Method: O.Record#getDoppelganger

        Parameters:
            store - {O.Store} A store to get this event in.

        Returns:
            {O.Record} Returns the record instance for the same record in the
            given store.
    */
    getDoppelganger: function ( store ) {
        if ( this.get( 'store' ) === store ) {
            return this;
        }
        return store.materialiseRecord(
            this.get( 'storeKey' ), this.constructor );
    },

    /**
        Method: O.Record#storeWillUnload

        This should only be called by the store, when it unloads the record's
        data to free up memory.
    */
    storeWillUnload: function () {
        Record.parent.destroy.call( this );
    },

    /**
        Property (private): O.Record#_noSync
        Type: Boolean

        If true, any changes to the record will not be committed to the source.
    */

    /**
        Method: O.Record#stopSync

        Any changes after this has been invoked will not by synced to the
        source.

        Returns:
            {O.Record} Returns self.
    */
    stopSync: function () {
        this._noSync = true;
        return this;
    },

    /**
        Method: O.Record#startSync

        If syncing has been stopped by a call to <O.Record#stopSync>, this
        will then enable it again for any *future* changes.

        Returns:
            {O.Record} Returns self.
    */
    startSync: function () {
        this._noSync = false;
        return this;
    },

    /**
        Property: O.Record#isEditable
        Type: Boolean
        Default: True

        May the record be edited/deleted?
    */
    isEditable: true,

    /**
        Property: O.Record#isValid
        Type: Boolean

        Are all the attributes are in a valid state?
    */
    isValid: function ( value ) {
        return ( value !== undefined ) ? value :
            !this.get( 'errorForAttribute' ).get( 'errorCount' );
    }.property(),

    /**
        Method: O.Record#errorToSet

        Checks whether it will be an error to set the attribute with the given
        key to the given value. If it will be an error, the string describing
        the error is returned, otherwise an empty string is returned.

        Parameters:
            key   - {String} The name of the attribute.
            value - {*} The proposed value to set it to.

        Returns:
            {O.ValidationError|null} The error, or null if the assignment would
            be valid.
    */
    errorToSet: function ( key, value ) {
        var attr = this[ key ];
        return attr.validate ? attr.validate( value, key, this ) : null;
    },

    /**
        Property: O.Record#errorForAttribute
        Type: O.Object

        Calling get() with the key for an attribute on this record will return
        an error string if the currently set value is invalid, or an empty
        string if the attribute is currently valid. You can bind to the
        properties on this object.
    */
    errorForAttribute: function () {
        return new AttributeErrors( this );
    }.property()
});

/**
    Property: O.Record.primaryKey
    Type: String

    Set automatically by the O.RecordAttribute with `isPrimaryKey: true`. If
    no primary key is set, there is presumed to be a property called "id"
    that is the primary key.
*/

NS.Record = Record;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RemoteQuery.js                                                       \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Record.js, Status.js                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var Status = NS.Status,
    EMPTY = Status.EMPTY,
    READY = Status.READY,
    DESTROYED = Status.DESTROYED,
    NON_EXISTENT = Status.NON_EXISTENT,
    // LOADING => The list is being fetched from the server.
    LOADING = Status.LOADING,
    // OBSOLETE => The list may have changed on the server since the last fetch
    // was initiated.
    OBSOLETE = Status.OBSOLETE;

/**
    Class: O.RemoteQuery

    Extends: O.Object

    Includes: O.Enumerable, O.ObservableRange

    A remote query is conceptually an array of records, where the contents of
    the array is calculated by a server rather than the client. In its simplest
    form, you would use remote query like this:

        var query = new O.RemoteQuery({
            store: TodoApp.store
            Type: TodoApp.TodoItem,
            filter: 'done',
            sort: 'dateAscending'
        });

    Your data source connected to the store must support the fetchQuery method
    (either directly or via a handler in the queryFetchers property). This
    should fetch the list of record ids that are the result of the query and
    pass this to the query via the sourceDidFetchQuery callback. To reduce round
    trips, you may also like to fetch the records themselves as part of this
    handler, but this is optional; if you do not, after the ids have been
    loaded, any observers will fetch the records they want from the query. This
    will in turn get them from the store, which will request any unloaded
    records from the source as normal.

    The sort and filter properties may have arbitrary value and type. They are
    there so your fetchQuery handler in source knows what to fetch. If they are
    changed, the query is refetched. The sort and filter properties in the
    object passed to the sourceDidFetchQuery callback must be identical to the
    current values in the query for the data to be accepted.

    The server may also return a state string, which represents the current
    state of the query. The source may then send this to the server if the query
    is refreshed; if there have been no changes, the server can then avoid
    sending back unneccessary data.

*/
var RemoteQuery = NS.Class({

    Extends: NS.Object,

    Mixin: [ NS.Enumerable, NS.ObservableRange ],

    id: function () {
        return NS.guid( this );
    }.property().nocache(),

    /**
        Property: O.RemoteQuery#sort
        Type: *

        The sort order to use for this query.
    */
    sort: '',

    /**
        Property: O.RemoteQuery#filter
        Type: *

        Any filter to apply to the query.
    */
    filter: '',

    /**
        Property: O.RemoteQuery#state
        Type: String

        A state string from the server to allow the query to fetch updates and
        to determine if its list is invalid.
    */

    /**
        Property: O.RemoteQuery#Type
        Type: O.Class

        The type of records this query contains.
    */
    Type: NS.Record,

    /**
        Property: O.RemoteQuery#store
        Type: O.Store
    */

    /**
        Property: O.RemoteQuery#source
        Type: O.Source
    */

    /**
        Property: O.RemoteQuery#status
        Type: O.Status

        The status of the query. Initially EMPTY, will be READY once it knows
        the number of records contained in the query and DESTROYED after you've
        finished with the query and called <O.RemoteQuery#destroy>. It may also
        have OBSOLETE and LOADING bits set as appropriate.
    */

    /**
        Method: O.RemoteQuery#is

        Checks whether the query has a particular status. You can also supply a
        union of statuses (e.g. `query.is(O.Status.OBSOLETE|O.Status.DIRTY)`),
        in which case it will return true if the query has *any* of these status
        bits set.

        Parameters:
            status - {O.Status} The status to check.

        Returns:
            {Boolean} True if the record has the queried status.
    */
    is: function ( status ) {
        return !!( this.get( 'status' ) & status );
    },

    /**
        Method: O.RemoteQuery#setObsolete

        Sets the OBSOLETE bit on the query's status value.

        Returns:
            {O.RemoteQuery} Returns self.
    */
    setObsolete: function () {
        return this.set( 'status', this.get( 'status' ) | OBSOLETE );
    },

    /**
        Method: O.RemoteQuery#setLoading

        Sets the LOADING bit on the query's status value.

        Returns:
            {O.RemoteQuery} Returns self.
    */
    setLoading: function () {
        return this.set( 'status', this.get( 'status' ) | LOADING );
    },

    /**
        Constructor: O.RemoteQuery

        Parameters:
            mixin - {Object} (optional) Any properties in this object will be
                    added to the new O.RemoteQuery instance before
                    initialisation (so you can pass it getter/setter functions
                    or observing methods).
    */
    init: function ( mixin ) {
        this._list = [];
        this._awaitingIdFetch = [];
        this._refresh = false;

        this.state = '';
        this.status = EMPTY;
        this.length = null;

        RemoteQuery.parent.init.call( this, mixin );

        this.get( 'store' ).addQuery( this );
    },

    /**
        Method: O.RemoteQuery#destroy

        Sets the status to DESTROYED, deregisters the query with the store and
        removes bindings and path observers so the object may be garbage
        collected.
    */
    destroy: function () {
        this.set( 'status', this.is( EMPTY ) ? NON_EXISTENT : DESTROYED );
        this.get( 'store' ).removeQuery( this );
        RemoteQuery.parent.destroy.call( this );
    },

    /**
        Method: O.RemoteQuery#refresh

        Update the query with any changes on the server.

        Parameters:
            force        - {Boolean} (optional) Unless this is true, the remote
                           query will only ask the source to fetch updates if it
                           is marked EMPTY or OBSOLETE.
            callback     - {Function} (optional) A callback to be made
                           when the refresh finishes.

        Returns:
            {O.RemoteQuery} Returns self.
    */
    refresh: function ( force, callback ) {
        var status = this.get( 'status' );
        if ( force || status === EMPTY || ( status & OBSOLETE ) ) {
            if ( status & READY ) {
                this._refresh = true;
            }
            this.get( 'source' ).fetchQuery( this, callback );
        } else if ( callback ) {
            callback();
        }
        return this;
    },

    /**
        Method: O.RemoteQuery#reset

        Resets the list, throwing away the id list, resetting the state string
        and setting the status to EMPTY. This is automatically triggered if the
        sort or filter properties change.

        Returns:
            {O.RemoteQuery} Returns self.
    */
    reset: function ( _, _key ) {
        var length = this.get( 'length' );

        this._list.length = 0;
        this._refresh = false;

        this.set( 'state', '' )
            .set( 'status', EMPTY )
            .set( 'length', null )
            .rangeDidChange( 0, length );

        if ( _key ) {
            this.get( 'source' ).fetchQuery( this );
        }

        return this.fire( 'query:reset' );
    }.observes( 'sort', 'filter' ),

    /**
        Method: O.RemoteQuery#getObjectAt

        Returns the record at the index given in the array, if loaded. It will
        also ensure the entire window that index is contained in is loaded and
        that the ids for the windows either side are loaded. If the index is in
        triggerPoint range of the end of the window, the adjacent window will
        be fully loaded, not just its ids.

        Parameters:
            index      - {Number} The index to return the record at.
            doNotFetch - {Boolean} (optional) If true, the
                         <fetchDataForObjectAt> method will not be called.

        Returns:
            {(O.Record|null|undefined)} If the requested index is negative or
            past the end of the array, undefined will be returned. Otherwise the
            record will be returned, or null if the id is not yet loaded.
    */
    getObjectAt: function ( index, doNotFetch ) {
        var length = this.get( 'length' );
        if ( length === null || index < 0 || index >= length ) {
            return undefined;
        }

        if ( !doNotFetch ) {
            doNotFetch = this.fetchDataForObjectAt( index );
        }

        var id = this._list[ index ];
        return id ?
            this.get( 'store' )
                .getRecord( this.get( 'Type' ), id, doNotFetch ) :
            null;
    },

    /**
        Method: O.RemoteQuery#fetchDataForObjectAt

        This method is called by <getObjectAt> before getting the id of the
        index given from the internal list and fetching the record from the
        store. By default this method does nothing, but subclasses may wish to
        override it to (pre)fetch certain data.

        Parameters:
            index - {Number} The index of the record being requested.

        Returns:
            {Boolean} Has the data for the object been fetched? If true, the
            store will be explicitly told not to fetch the data, as the fetching
            is being handled by the query.
    */
    fetchDataForObjectAt: function (/* index */) {
        return false;
    },

    /**
        Property: O.RemoteQuery#length
        Type: (Number|null)

        The length of the list of records matching the query, or null if
        unknown.
    */

    /**
        Method: O.RemoteQuery#indexOfId

        Finds the index of an id in the query. Since the entire list may not be
        loaded, this data may have to be loaded from the server so you should
        rely on the callback if you need an accurate result. If the id is not
        found, the index returned will be -1.

        Parameters:
            id       - {String} The record id to find.
            from     - {Number} The first index to start the search from.
                       Specify 0 to search the whole list.
            callback - {Function} (optional) A callback to make with the id
                       when found.

        Returns:
            {Number} The index of the id, or -1 if not found.
    */
    indexOfId: function ( id, from, callback ) {
        var index = this._list.indexOf( id, from );
        if ( callback ) {
            if ( this.get( 'length' ) === null ) {
                this.get( 'source' ).fetchQuery( this, function () {
                    callback( this._list.indexOf( id, from ) );
                }.bind( this ) );
            } else {
                callback( index );
            }
        }
        return index;
    },

    /**
        Method: O.RemoteQuery#getIdsForObjectsInRange

        Makes a callback with a subset of the ids for records in this query.

        The start and end values will be constrained to be inside the bounds of
        the array. If length is not yet known or is 0, the callback will be made
        with an empty list and it will immediately return false. Otherwise it
        will attempt to fetch the ids and make the callback when they are
        fetched. If the callback happened before the function returns, false
        will be returned. Otherwise true will be returned. (i.e. the return
        value indicates whether we are still waiting for data).

        Parameters:
            start    - {Number} The index of the first record whose id is to be
                       returned.
            end      - {Number} One past the index of the last record to be
                       returned.
            callback - {Function} This will be called with the array of ids as
                       the first argument, the index of the first returned
                       result as the second argument, and one past the index
                       of the last result as the third argument.

        Returns:
            {Boolean} Is the data still loading? (i.e. this is true if the
            callback was not fired synchronously, but rather will be called
            asynchronously at a later point.)
    */
    getIdsForObjectsInRange: function ( start, end, callback ) {
        var length = this.get( 'length' );

        if ( length === null ) {
            this._awaitingIdFetch.push([ start, end, callback ]);
            this.refresh();
            return true;
        }

        if ( start < 0 ) { start = 0 ; }
        if ( end > length ) { end = length; }
        callback( this._list.slice( start, end ), start, end );

        return false;
    },

    /**
        Method: O.RemoteQuery#getIdsForAllObjects

        Get a callback with an array of the id properties for all records in the
        query.

        Parameters:
            callback - {Function} This will be called with the array of ids as
                       the first argument, the index of the first returned
                       result as the second argument, and one past the index
                       of the last result as the third argument.

        Returns:
            {Boolean} Is the data still loading? (i.e. this is true if the
            callback was not fired synchronously, but rather will be called
            asynchronously at a later point.)
    */
    getIdsForAllObjects: function ( callback ) {
        // 0x7fffffff is the largest positive signed 32-bit number.
        return this.getIdsForObjectsInRange( 0, 0x7fffffff, callback );
    },

    /**
        Method (private): O.RemoteQuery#_adjustIdFetches

        Modifies the id range to be returned in the callback to
        <O.RemoteQuery#getIdsForObjectsInRange> in response to an update from
        the server.

        We adjust the range being fetched mainly so that new records that are
        inserted at the top of the list during a selection are not selected.
        Otherwise you may hit select all then as soon as it's selected hit
        delete, but in the meantime a new record arrives at the top of the list;
        if this were included in the selection it may be accidentally deleted.

        Parameters:
            removed - {Number[]} The list of indexes which were removed.
            added   - {Number[]} The list of indexes where new records
                       were addded.
    */
    _adjustIdFetches: function ( event ) {
        var added = event.addedIndexes,
            removed = event.removedIndexes,
            awaitingIdFetch = this._awaitingIdFetch,
            i, l, call, start, end, j, ll, index;
        for ( i = 0, l = awaitingIdFetch.length; i < l; i += 1 ) {
            call = awaitingIdFetch[i];
            start = call[0];
            end = call[1];

            for ( j = 0, ll = removed.length; j < ll; j += 1 ) {
                index = removed[j];
                if ( index < start ) { start -= 1; }
                if ( index < end ) { end -= 1; }
            }

            for ( j = 0, ll = added.length; j < ll; j += 1 ) {
                index = added[j];
                if ( index <= start ) { start += 1; }
                if ( index < end ) { end += 1; }
            }

            // Update waiting method call arguments
            call[0] = start;
            call[1] = end;
        }
    }.on( 'query:updated' ),

    /**
        Method (private): O.RemoteQuery#_idsWereFetched

        This processes any waiting callbacks after a fetch has completed. There
        may be multiple packets arriving so this method is only invoked once per
        runloop, before bindings sync (which will be after all data packets have
        been delivered).
    */
    _idsWereFetched: function () {
        var awaitingIdFetch = this._awaitingIdFetch;
        if ( awaitingIdFetch.length ) {
            awaitingIdFetch.forEach( function ( call ) {
                this.getIdsForObjectsInRange( call[0], call[1], call[2] );
            }, this );
            awaitingIdFetch.length = 0;
        }
    }.queue( 'before' ).on( 'query:idsLoaded' ),

    /**
        Method: O.RemoteQuery#sourceWillFetchQuery

        The source should call this method just before it fetches the query. By
        default this function just sets the loading flag on the query, but
        subclasses may like to return an object reflecting exactly the what the
        source should fetch (see <O.WindowedRemoteQuery#sourceWillFetchQuery)
        for example.

        Returns:
            {Boolean} Does the list need refreshing or just fetching (the two
            cases may be the same, but can be handled separately if the server
            has an efficient way of calculating changes from the state).
    */
    sourceWillFetchQuery: function () {
        var refresh = this._refresh;
        this._refresh = false;
        this.set( 'status',
            ( this.get( 'status' )|LOADING ) & ~OBSOLETE );
        return refresh;
    },

    /**
        Method: O.RemoteQuery#sourceDidFetchQuery

        The source should call this method with the data returned from fetching
        the query. The single argument is an object which should contain the
        following properties:

        sort   - {String} The sort used for the query.
        filter - {String} The filter used for the query.
        idList - {String[]} The ids of the records represented by this
                 query.
        state  - {String} (optional) A string representing the state of the
                 query on the server at the time of the fetch.

        Parameters:
            args - {Object} See description above.

        Returns:
            {RemoteQuery} Returns self.
    */
    sourceDidFetchQuery: function ( args ) {
        // User may have changed sort or filter in intervening time; presume the
        // value on the object is the right one, so if data doesn't match, just
        // ignore it.
        if ( this.get( 'sort' ) !== args.sort ||
                this.get( 'filter' ) !== args.filter ) {
            return;
        }

        this.set( 'state', args.state );

        // Could use a proper diffing algorithm to calculate added/removed
        // arrays, but probably not worth it.
        var oldList = this._list,
            list = this._list = args.idList,
            oldTotal = this.get( 'length' ),
            total = list.length,
            removedIndexes = [],
            removedIds = [],
            addedIndexes = [],
            addedIds = [],
            firstChange = 0,
            lastChangeNew = total - 1,
            lastChangeOld = ( oldTotal || 0 ) - 1,
            l = Math.min( total, oldTotal || 0 ),
            i;

        // Initial fetch, oldTotal === null
        if ( oldTotal !== null ) {
            while ( firstChange < l &&
                    list[ firstChange ] === oldList[ firstChange ] ) {
                firstChange += 1;
            }

            while ( lastChangeNew >= 0 && lastChangeOld >= 0 &&
                    ( list[ lastChangeNew ] === oldList[ lastChangeOld ] ) ) {
                lastChangeNew -= 1;
                lastChangeOld -= 1;
            }

            for ( i = firstChange; i <= lastChangeOld; i += 1 ) {
                removedIndexes.push( i );
                removedIds.push( oldList[i] );
            }

            for ( i = firstChange; i <= lastChangeNew; i += 1 ) {
                addedIndexes.push( i );
                addedIds.push( list[i] );
            }
        }

        lastChangeNew = ( total === oldTotal ) ?
            lastChangeNew + 1 : Math.max( oldTotal || 0, total );

        this.beginPropertyChanges()
            .set( 'status', READY|( this.is( OBSOLETE ) ? OBSOLETE : 0 ) )
            .set( 'length', total );
        if ( firstChange < lastChangeNew ) {
            this.rangeDidChange( firstChange, lastChangeNew );
        }
        this.endPropertyChanges();

        if ( oldTotal !== null && firstChange < lastChangeNew ) {
            this.fire( 'query:updated', {
                removed: removedIds,
                removedIndexes: removedIndexes,
                added: addedIds,
                addedIndexes: addedIndexes
            });
        }
        return this.fire( 'query:idsLoaded' );
    }
});

NS.RemoteQuery = RemoteQuery;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: WindowedRemoteQuery.js                                               \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Status.js, RemoteQuery.js                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var Status = NS.Status,
    EMPTY = Status.EMPTY,
    READY = Status.READY,
    // DIRTY => A preemptive update has been applied since the last fetch of
    // updates from the server was *initiated*. Therefore, any update we receive
    // may not cover all of the preemptives.
    DIRTY = Status.DIRTY,
    // LOADING => An *update* is being fetched from the server
    LOADING = Status.LOADING,
    // OBSOLETE => The data on the server may have changed since the last update
    // was requested.
    OBSOLETE = Status.OBSOLETE;

/**
    Enum: O.WindowedRemoteQuery-WindowState

    The state of each window in the query is represented as follows:

    WINDOW_EMPTY             - Initial state. The window has not even been
                               requested.
    WINDOW_REQUESTED         - The ids in the window have been requested
    WINDOW_LOADING           - The ids in the window are being loaded by the
                               source.
    WINDOW_READY             - The ids in the window are all loaded and ready.
    WINDOW_RECORDS_REQUESTED - The records in the window have been requested.
    WINDOW_RECORDS_LOADING   - The records in the window are loading.
    WINDOW_RECORDS_READY     - The records in the window are ready.
*/
var WINDOW_EMPTY = 0,
    WINDOW_REQUESTED = 1,
    WINDOW_LOADING = 2,
    WINDOW_READY = 4,
    WINDOW_RECORDS_REQUESTED = 8,
    WINDOW_RECORDS_LOADING = 16,
    WINDOW_RECORDS_READY = 32;

/**
    Method: O.WindowedRemoteQuery-sortLinkedArrays

    Sorts an array whilst performing the same swaps on a second array, so that
    if item x was in position i in array 1, and item y was in position i in
    array 2, then after this function has been called, if item x is in posiiton
    j in array 1, then item y will be in position j in array 2.

    The arrays are sorted in place.

    Parameters:
        a1 - {Array} The array to sort.
        a2 - {Array} The array to perform the same swaps on.
*/
var sortLinkedArrays = function ( a1, a2 ) {
    var zipped = a1.map( function ( item, i ) {
        return [ item, a2[i] ];
    });
    zipped.sort( function ( a, b ) {
        return a[0] - b[0];
    });
    zipped.forEach( function ( item, i ) {
        a1[i] = item[0];
        a2[i] = item[1];
    });
};

var mapIndexes = function ( list, ids ) {
    var indexOf = {},
        indexes = [],
        listLength = list.length,
        idsLength = ids.length,
        id, index, i;
    // Since building the map will be O(n log n), only bother if we're trying to
    // find the index for more than log(n) ids.
    // The +1 ensures it is always at least 1, so that in the degenerative case
    // where idsLength == 0, we never bother building the map
    // When listLength == 0, Math.log( 0 ) == -Infinity, which is converted to 0
    // by ~~ integer conversion.
    if ( idsLength < ~~Math.log( listLength ) + 1 ) {
        for ( i = 0; i < idsLength; i += 1 ) {
            indexes.push( list.indexOf( ids[i] ) );
        }
    } else {
        for ( i = 0; i < listLength; i += 1 ) {
            id = list[i];
            if ( id ) {
                indexOf[ id ] = i;
            }
        }
        for ( i = 0; i < idsLength; i += 1 ) {
            index = indexOf[ ids[i] ];
            indexes.push( index === undefined ? -1 : index );
        }
    }
    return indexes;
};

/**
    Method: O.WindowedRemoteQuery-mergeSortedLinkedArrays

    Parameters:
        a1 - {Array}
        a2 - {Array}
        b1 - {Array}
        b2 - {Array}

    Returns:
        {[Array,Array]} A tuple of two arrays.
*/
var mergeSortedLinkedArrays = function ( a1, a2, b1, b2 ) {
    var rA = [],
        rB = [],
        i = 0,
        j = 0,
        l1 = a1.length,
        l2 = a2.length;

    // Take the smallest head element each time.
    while ( i < l1 || j < l2 ) {
        if ( j >= l2 || ( i < l1 && a1[i] < a2[j] ) ) {
            rA.push( a1[i] );
            rB.push( b1[i] );
            i += 1;
        } else {
            rA.push( a2[j] );
            rB.push( b2[j] );
            j += 1;
        }
    }
    return [ rA, rB ];
};

var adjustIndexes =
        function ( removed, added, removedBefore, ids, removedBeforeIds ) {
    var resultIndexes = [],
        resultIds = [],
        i, l, index, position, j, ll;
    for ( i = 0, l = removed.length; i < l; i += 1 ) {
        // Take the item removed in the second update
        index = removed[i];
        // And see how many items were added in the first update
        // before it
        position = added.binarySearch( index );
        // If there was an item added in the first update at the exact same
        // position, we don't need to do anything as they cancel each other out.
        // Since update 2 is from the state left by update 1, the ids MUST be
        // the same.
        if ( index === added[ position ] ) {
            continue;
        }
        // Otherwise, subtract the number of items added before it, as
        // these didn't exist in the original state.
        index -= position;
        // Now consider the indexes that were removed in the first
        // update. We need to increment the index for all indexes
        // before or equal to the index we're considering.
        for ( j = 0, ll = removedBefore.length;
                j < ll && index >= removedBefore[j]; j += 1 ) {
            index += 1;
        }
        // Now we have the correct index.
        resultIndexes.push( index );
        resultIds.push( ids[i] );
    }
    return mergeSortedLinkedArrays(
        removedBefore, resultIndexes, removedBeforeIds, resultIds );
};

var composeUpdates = function ( u1, u2 ) {
    var removed = adjustIndexes(
            u2.removedIndexes, u1.addedIndexes,  u1.removedIndexes,
            u2.removedIds, u1.removedIds ),
        added = adjustIndexes(
            u1.addedIndexes, u2.removedIndexes, u2.addedIndexes,
            u1.addedIds, u2.addedIds );

    return {
        removedIndexes: removed[0],
        removedIds: removed[1],
        addedIndexes: added[0],
        addedIds: added[1],
        truncateAtFirstGap:
            u1.truncateAtFirstGap || u2.truncateAtFirstGap,
        total: u2.total,
        upto: u2.upto
    };
};

var invertUpdate = function ( u ) {
    var array = u.removedIndexes;
    u.removedIndexes = u.addedIndexes;
    u.addedIndexes = array;

    array = u.removedIds;
    u.removedIds = u.addedIds;
    u.addedIds = array;

    u.total = u.total + u.addedIds.length - u.removedIds.length;

    return u;
};

// Where (a,b) and (c,d) are ranges.
// and a < b and c < d.
var intersect = function ( a, b, c, d ) {
    return a < c ? c < b : a < d;
};

// A window is determined to be still required if there is a range observer that
// intersects with any part of the window. The prefetch distance is added to the
// observer range.
var windowIsStillInUse = function ( index, windowSize, prefetch, ranges ) {
    var start = index * windowSize,
        margin = prefetch * windowSize,
        j = ranges.length,
        range, rangeStart, rangeEnd, rangeIntersectsWindow;
    while ( j-- ) {
        range = ranges[j];
        rangeStart = range.start || 0;
        if ( !( 'end' in range ) ) {
            break;
        }
        rangeEnd = range.end;
        rangeIntersectsWindow = intersect(
            start,
            start + windowSize,
            rangeStart - margin,
            rangeEnd + margin
        );
        if ( rangeIntersectsWindow ) {
            break;
        }
    }
    return ( j !== -1 );
};

/**
    Class: O.WindowedRemoteQuery

    Extends: O.RemoteQuery

    A windowed remote query represents a potentially very large array of records
    calculated by the server. Records are loaded in blocks (windows); for
    example, with a window size of 30, accessing any record at indexes 0--29
    will cause all records within that range to be loaded, but does not
    necessarily load anything else.

    The class also supports an efficient modification sequence system for
    calculating, transfering and applying delta updates as the results of the
    query changes.
*/
var WindowedRemoteQuery = NS.Class({

    Extends: NS.RemoteQuery,

    /**
        Property: O.WindowedRemoteQuery#windowSize
        Type: Number

        The number of records that make up one window.
    */
    windowSize: 30,

    windowCount: function () {
        var length = this.get( 'length' );
        return ( length === null ) ? length :
            Math.floor( ( length - 1 ) / this.get( 'windowSize' ) ) + 1;
    }.property( 'length' ),

    /**
        Property: O.WindowedRemoteQuery#triggerPoint
        Type: Number

        If the record at an index less than this far from the end of a window is
        requested, the adjacent window will also be loaded (prefetching based on
        locality)
    */
    triggerPoint: 10,

    /**
        Property: O.WindowedRemoteQuery#optimiseFetching
        Type: Boolean

        If true, if a requested window is no longer either observed or adjacent
        to an observed window at the time <sourceWillFetchQuery> is called, the
        window is not actually requested.
    */
    optimiseFetching: false,

    /**
        Property: O.WindowedRemoteQuery#prefetch
        Type: Number

        The number of windows either side of an explicitly requested window, for
        which ids should be fetched.
    */
    prefetch: 1,

    /**
        Property: O.WindowedRemoteQuery#canGetDeltaUpdates
        Type: Boolean

        If the state is out of date, can the source fetch the delta of exactly
        what has changed, or does it just need to throw out the current list and
        refetch?
    */
    canGetDeltaUpdates: true,

    /**
        Property (private): O.WindowedRemoteQuery#_isAnExplicitIdFetch
        Type: Boolean

        This is set to true when an explicit request is made to fetch ids (e.g.
        through <O.RemoteQuery#getIdsForObjectsInRange>). This prevents the
        query from optimising away the request when it corresponds to a
        non-observed range in the query.
    */

    init: function ( mixin ) {
        this._windows = [];
        this._indexOfRequested = [];
        this._waitingPackets = [];
        this._preemptiveUpdates = [];

        this._isAnExplicitIdFetch = false;

        WindowedRemoteQuery.parent.init.call( this, mixin );
    },

    reset: function ( _, _key ) {
        this._windows.length =
        this._indexOfRequested.length =
        this._waitingPackets.length =
        this._preemptiveUpdates.length = 0;

        this._isAnExplicitIdFetch = false;

        WindowedRemoteQuery.parent.reset.call( this, _, _key );
    }.observes( 'sort', 'filter' ),

    indexOfId: function ( id, from, callback ) {
        var index = this._list.indexOf( id, from ),
            windows, l;
        if ( callback ) {
            // If we have a callback and haven't found it yet, we need to keep
            // searching.
            if ( index < 0 ) {
                // First check if the list is loaded
                l = this.get( 'windowCount' );
                if ( l !== null ) {
                    windows = this._windows;
                    while ( l-- ) {
                        if ( !( windows[l] & WINDOW_READY ) ) {
                            break;
                        }
                    }
                    // Everything loaded; the id simply isn't in it.
                    // index is -1.
                    if ( l < 0 ) {
                        callback( index );
                        return index;
                    }
                }
                // We're missing part of the list, so it may be in the missing
                // bit.
                this._indexOfRequested.push( [ id, function () {
                    callback( this._list.indexOf( id, from ) );
                }.bind( this ) ] );
                this.get( 'source' ).fetchQuery( this );
            } else {
                callback( index );
            }
        }
        return index;
    },

    getIdsForObjectsInRange: function ( start, end, callback ) {
        var length = this.get( 'length' ),
            isComplete = true,
            windows, windowSize, i, l;

        if ( length !== null ) {
            if ( start < 0 ) { start = 0; }
            if ( end > length ) { end = length; }

            windows = this._windows;
            windowSize = this.get( 'windowSize' );
            i = Math.floor( start / windowSize );
            l = Math.floor( ( end - 1 ) / windowSize ) + 1;

            for ( ; i < l; i += 1 ) {
                if ( !( windows[i] & WINDOW_READY ) ) {
                    isComplete = false;
                    this._isAnExplicitIdFetch = true;
                    this.fetchWindow( i, false, 0 );
                }
            }
        } else {
            isComplete = false;
        }

        if ( isComplete ) {
            callback( this._list.slice( start, end ), start, end );
        }
        else {
            this._awaitingIdFetch.push([ start, end, callback ]);
        }
        return !isComplete;
    },

    // Fetches all ids and records in window.
    // If within trigger distance of window edge, fetches adjacent window as
    // well.
    fetchDataForObjectAt: function ( index ) {
        // Load all headers in window containing index.
        var windowSize = this.get( 'windowSize' ),
            trigger = this.get( 'triggerPoint' ),
            windowIndex = Math.floor( index / windowSize ),
            withinWindowIndex = index % windowSize;

        this.fetchWindow( windowIndex, true );

        // If within trigger distance of end of window, load next window
        // Otherwise, just fetch Ids for next window.
        if ( withinWindowIndex < trigger ) {
            this.fetchWindow( windowIndex - 1, true );
        }
        if ( withinWindowIndex + trigger >= windowSize ) {
            this.fetchWindow( windowIndex + 1, true );
        }
        return true;
    },

    /**
        Method: O.WindowedRemoteQuery#fetchWindow

        Fetches all records in the window with the index given. e.g. if the
        window size is 30, calling this with index 1 will load all records
        between positions 30 and 59 (everything 0-indexed).

        Also fetches the ids for all records in the window either side.

        Parameters:
            index        - {Number} The index of the window to load.
            fetchRecords - {Boolean}
            prefetch     - {Number} (optional)

        Returns:
            {O.WindowedRemoteQuery} Returns self.
    */
    fetchWindow: function ( index, fetchRecords, prefetch ) {
        var status = this.get( 'status' ),
            windows = this._windows,
            doFetch = false,
            i, l;

        if ( status & OBSOLETE ) {
            this.refresh();
        }

        if ( prefetch === undefined ) {
            prefetch = this.get( 'prefetch' );
        }

        i = Math.max( 0, index - prefetch );
        l = Math.min( index + prefetch + 1, this.get( 'windowCount' ) || 0 );

        for ( ; i < l; i += 1 ) {
            status = windows[i] || 0;
            if ( status === WINDOW_EMPTY ) {
                status = WINDOW_REQUESTED;
                doFetch = true;
            }
            if ( i === index && fetchRecords &&
                    status < WINDOW_RECORDS_REQUESTED ) {
                if ( ( status & WINDOW_READY ) &&
                        this.checkIfWindowIsFetched( i ) ) {
                    status = (WINDOW_READY|WINDOW_RECORDS_READY);
                } else {
                    status = status | WINDOW_RECORDS_REQUESTED;
                    doFetch = true;
                }
            }
            windows[i] = status;
        }
        if ( doFetch ) {
            this.get( 'source' ).fetchQuery( this );
        }
        return this;
    },

    // Precondition: all ids are known
    checkIfWindowIsFetched: function ( index ) {
        var store = this.get( 'store' ),
            Type = this.get( 'Type' ),
            windowSize = this.get( 'windowSize' ),
            list = this._list,
            i = index * windowSize,
            l = Math.min( i + windowSize, this.get( 'length' ) );
        for ( ; i < l; i += 1 ) {
            if ( store.getRecordStatus( Type, list[i] ) & (EMPTY|OBSOLETE) ) {
                return false;
            }
            return true;
        }
    },

    /**
        Method: O.WindowedRemoteQuery#recalculateFetchedWindows

        Recalculates whether the ids and records are fetched for windows,
        for all windows with an index equal or greater than that of the window
        containing the start index given.

        Although the information on whether the records for a window are loaded
        is reset, it is not recalculated; this will be done on demand when a
        fetch is made for the window.

        Parameters:
            start - {Number} The index of the first record to have changed (i.e.
                    invalidate all window information starting from the window
                    containing this index).
            length - {Number} The new length of the list.
    */
    recalculateFetchedWindows: function ( start, length ) {
        if ( !start ) { start = 0; }
        if ( length === undefined ) { length = this.get( 'length' ); }

        var windowSize = this.get( 'windowSize' ),
            windows = this._windows,
            list = this._list,
            // Start at last window index
            windowIndex = Math.floor( ( length - 1 ) / windowSize ),
            // And last list index
            listIndex = length - 1,
            target, status;

        // Convert start from list index to window index.
        start = Math.floor( start / windowSize );

        // Truncate any non-existant windows.
        windows.length = windowIndex + 1;

        // Unless there's something defined for all properties between
        // listIndex and windowIndex we must remove the WINDOW_READY flag.
        // We always remove WINDOWS_RECORDS_READY flag, and calculate this when
        // the window is requested.
        while ( windowIndex >= start ) {
            target = windowIndex * windowSize;
            // Always remove WINDOWS_RECORDS_READY flag; this is recalculated
            // lazily when the window is fetched.
            status = ( windows[ windowIndex ] || 0 ) & ~WINDOW_RECORDS_READY;
            // But the window might be ready, so add the WINDOW_READY flag and
            // then remove it if we find a gap in the window.
            status |= WINDOW_READY;
            while ( listIndex >= target ) {
                if ( !list[ listIndex ] ) {
                    status = status & ~WINDOW_READY;
                    break;
                }
                listIndex -= 1;
            }
            // Set the new status
            windows[ windowIndex ] = status;
            listIndex = target - 1;
            windowIndex -= 1;
        }
        return this;
    },

    // ---- Updates ---

    _normaliseUpdate: function ( update ) {
        var list = this._list,
            removedIds = update.removed || [],
            removedIndexes = mapIndexes( list, removedIds ),
            addedIds = [],
            addedIndexes = [],
            added = update.added || [],
            i, j, l, item, index, id;

        sortLinkedArrays( removedIndexes, removedIds );
        for ( i = 0; removedIndexes[i] === -1; i += 1 ) {
            // Do nothing (we just want to find the first index of known
            // position).
        }
        // If we have some ids we don't know the index of.
        if ( i ) {
            // Ignore them.
            removedIndexes = removedIndexes.slice( i );
            removedIds = removedIds.slice( i );
        }
        // But truncate at first gap.
        update.truncateAtFirstGap = !!i;
        update.removedIndexes = removedIndexes;
        update.removedIds = removedIds;

        for ( i = 0, l = added.length; i < l; i += 1 ) {
            item = added[i];
            index = item[0];
            id = item[1];
            j = removedIds.indexOf( id );

            if ( j > -1 &&
                    removedIndexes[j] - j + addedIndexes.length === index ) {
                removedIndexes.splice( j, 1 );
                removedIds.splice( j, 1 );
            } else {
                addedIndexes.push( index );
                addedIds.push( id );
            }
        }
        update.addedIndexes = addedIndexes;
        update.addedIds = addedIds;

        if ( !( 'total' in update ) ) {
            update.total = this.get( 'length' ) -
                removedIndexes.length + addedIndexes.length;
        }

        return update;
    },

    _applyUpdate: function ( args ) {
        var removedIndexes = args.removedIndexes,
            removedIds = args.removedIds,
            removedLength = removedIds.length,
            addedIndexes = args.addedIndexes,
            addedIds = args.addedIds,
            addedLength = addedIds.length,
            list = this._list,
            recalculateFetchedWindows = !!( addedLength || removedLength ),
            oldLength = this.get( 'length' ),
            newLength = args.total,
            firstChange = oldLength,
            i, l, index, id, listLength;

        // --- Remove items from list ---

        l = removedLength;
        while ( l-- ) {
            index = removedIndexes[l];
            list.splice( index, 1 );
            if ( index < firstChange ) { firstChange = index; }
        }

        if ( args.truncateAtFirstGap ) {
            // Truncate the list so it does not contain any gaps; anything after
            // the first gap may be incorrect as a record may have been removed
            // from that gap.
            i = 0;
            while ( list[i] ) { i += 1; }
            list.length = i;
            if ( i < firstChange ) { firstChange = i; }
        }

        // --- Add items to list ---

        // If the index is past the end of the array, you can't use splice
        // (unless you set the length of the array first), so use standard
        // assignment.
        listLength = list.length;
        for ( i = 0, l = addedLength; i < l; i += 1 ) {
            index = addedIndexes[i];
            id = addedIds[i];
            if ( index >= listLength ) {
                list[ index ] = id;
                listLength = index + 1;
            } else {
                list.splice( index, 0, id );
                listLength += 1;
            }
            if ( index < firstChange ) { firstChange = index; }
        }

        // --- Check upto ---

        // upto is the last item id the updates are to. Anything after here
        // may have changed, but won't be in the updates, so we need to truncate
        // the list to ensure it doesn't get into an inconsistent state.
        // If we can't find the id, we have to reset.
        if ( args.upto ) {
            l = list.lastIndexOf( args.upto ) + 1;
            if ( l ) {
                if ( l !== listLength ) {
                    recalculateFetchedWindows = true;
                    list.length = l;
                }
            } else {
                return this.reset();
            }
        }

        // --- Recalculate fetched windows ---

        // Anything from the firstChange index onwards may have changed, so we
        // have to recalculate which windows that cover indexes from this point
        // onwards we now have ids for. We only bother to recalculate whether we
        // have a complete set of ids; if the window needs an update or does
        // not have all records in memory, this will be recalculated when it is
        // accessed.
        if ( recalculateFetchedWindows ) {
            this.recalculateFetchedWindows( firstChange, newLength );
        }

        // --- Broadcast changes ---

        this.set( 'length', newLength )
            .rangeDidChange( firstChange, Math.max( oldLength, newLength ) );

        // For selection purposes, list view will need to know the ids of those
        // which were removed. Also, keyboard indicator will need to know the
        // indexes of those removed or added.
        this.fire( 'query:updated', {
            removed: removedIds,
            removedIndexes: removedIndexes,
            added: addedIds,
            addedIndexes: addedIndexes
        });

        // --- And process any waiting data packets ---

        this._applyWaitingPackets();

        return this;
    },

    _applyWaitingPackets: function () {
        var didDropPackets = false,
            waitingPackets = this._waitingPackets,
            l = waitingPackets.length,
            state = this.get( 'state' ),
            packet;

        while ( l-- ) {
            packet = waitingPackets.shift();
            // If these values aren't now the same, the packet must
            // be OLDER than our current state, so just discard.
            if ( packet.state !== state ) {
                // But also fetch everything missing in observed range, to
                // ensure we have the required data
                didDropPackets = true;
            } else {
                this.sourceDidFetchIdList( packet );
            }
        }
        if ( didDropPackets ) {
            this._fetchObservedWindows();
        }
    },

    _fetchObservedWindows: function () {
        var ranges = NS.meta( this ).rangeObservers,
            length = this.get( 'length' ),
            windowSize = this.get( 'windowSize' ),
            observerStart, observerEnd,
            firstWindow, lastWindow,
            range, l;
        if ( ranges ) {
            l = ranges.length;
            while ( l-- ) {
                range = ranges[l].range;
                observerStart = range.start || 0;
                observerEnd = 'end' in range ? range.end : length;
                if ( observerStart < 0 ) { observerStart += length; }
                if ( observerEnd < 0 ) { observerEnd += length; }
                firstWindow = Math.floor( observerStart / windowSize );
                lastWindow = Math.floor( ( observerEnd - 1 ) / windowSize );
                for ( ; firstWindow <= lastWindow; firstWindow += 1 ) {
                    this.fetchWindow( firstWindow, true );
                }
            }
        }
    },

    /**
        Method: O.WindowedRemoteQuery#clientDidGenerateUpdate

        Call this to update the list with what you think the server will do
        after an action has committed. The change will be applied immediately,
        making the UI more responsive, and be checked against what actually
        happened next time an update arrives. If it turns out to be wrong the
        list will be reset, but in most cases it should appear more efficient.

        removed - {String[]} (optional) The ids of all records to delete.
        added   - {[Number,String][]} (optional) A list of [ index, id ] pairs,
                  in ascending order of index, for all records to be inserted.

        Parameters:
            update - {Object} The removed/added updates to make.

        Returns:
            {O.WindowedRemoteQuery} Returns self.
    */
    clientDidGenerateUpdate: function ( update ) {
        this._normaliseUpdate( update );
        // Ignore completely any ids we don't have.
        update.truncateAtFirstGap = false;
        this._applyUpdate( update );
        this._preemptiveUpdates.push( update );
        this.set( 'status', this.get( 'status' ) | DIRTY );
        this.refresh( true );
        return this;
    },

    /**
        Method: O.WindowedRemoteQuery#sourceDidFetchUpdate

        The source should call this when it fetches a delta update for the
        query. The args object should contain the following properties:

        newState - {String} The state this delta updates the remote query to.
        oldState - {String} The state this delta updates the remote query from.
        sort     - {*} The sort presumed in this delta.
        filter   - {*} The filter presumed in this delta.
        removed  - {String[]} The ids of all records removed since
                   oldState.
        added    - {[Number,String][]} A list of [ index, id ] pairs, in
                   ascending order of index, for all records added since
                   oldState.
        upto     - {String} (optional) As an optimisation, updates may only be
                   for the first portion of a list, upto a certain id. This is
                   the last id which is included in the range covered by the
                   updates; any information past this id must be discarded, and
                   if the id can't be found the list must be reset.
        total    - {Number} (optional) The total number of records in the list.

        Parameters:
            update - {Object} The delta update (see description above).

        Returns:
            {O.WindowedRemoteQuery} Returns self.
    */
    sourceDidFetchUpdate: ( function () {
        var equalArrays = function ( a1, a2 ) {
            var l = a1.length;
            if ( a2.length !== l ) { return false; }
            while ( l-- ) {
                if ( a1[l] !== a2[l] ) { return false; }
            }
            return true;
        };

        var updateIsEqual = function ( u1, u2 ) {
            return u1.total === u2.total &&
                equalArrays( u1.addedIndexes, u2.addedIndexes ) &&
                equalArrays( u1.addedIds, u2.addedIds ) &&
                equalArrays( u1.removedIndexes, u2.removedIndexes ) &&
                equalArrays( u1.removedIds, u2.removedIds );
        };

        return function ( update ) {
            var state = this.get( 'state' ),
                status = this.get( 'status' ),
                preemptives = this._preemptiveUpdates,
                l = preemptives.length,
                allPreemptives, composed, i;

            // We've got an update, so we're no longer in the LOADING state.
            this.set( 'status', status & ~LOADING );

            // Check we've not already got this update.
            if ( state === update.newState ) {
                if ( l && !( status & DIRTY ) ) {
                    allPreemptives = preemptives.reduce( composeUpdates );
                    this._applyUpdate( invertUpdate( allPreemptives ) );
                    preemptives.length = 0;
                }
                return this;
            }
            // We can only update from our old state.
            if ( state !== update.oldState ) {
                return this.setObsolete();
            }
            // Check the sort and filter is still the same
            if ( !NS.isEqual( update.sort, this.get( 'sort' ) ) ||
                    !NS.isEqual( update.filter, this.get( 'filter' ) ) ) {
                return this;
            }
            // Set new state
            this.set( 'state', update.newState );

            if ( !l ) {
                this._applyUpdate( this._normaliseUpdate( update ) );
            } else {
                // 1. Compose all preemptives:
                // [p1, p2, p3] -> [p1, p1 + p2, p1 + p2 + p3 ]
                composed = [ preemptives[0] ];
                for ( i = 1; i < l; i += 1 ) {
                    composed[i] = composeUpdates(
                        composed[ i - 1 ], preemptives[i] );
                }

                // 2. Normalise the update from the server. This is trickier
                // than normal, as we need to determine what the indexes of the
                // removed ids were in the previous state.
                var normalisedUpdate = this._normaliseUpdate({
                    added: update.added,
                    total: update.total,
                    upto: update.upto
                });

                // Find the removedIndexes for our update. If they were removed
                // in the composed preemptive, we have the index. Otherwise, we
                // need to search for the id in the current list then compose
                // the result with the preemptive in order to get the original
                // index.
                var removed = update.removed,
                    _indexes = [],
                    _ids = [],
                    removedIndexes = [],
                    removedIds = [],
                    addedIndexes, addedIds,
                    list = this._list,
                    wasSuccessfulPreemptive = false,
                    id, index;

                allPreemptives = composed[ l - 1 ];
                for ( i = 0, l = removed.length; i < l; i += 1 ) {
                    id = removed[i];
                    index = allPreemptives.removedIds.indexOf( id );
                    if ( index > -1 ) {
                        removedIndexes.push(
                            allPreemptives.removedIndexes[ index ] );
                        removedIds.push( id );
                    } else {
                        index = list.indexOf( id );
                        if ( index > -1 ) {
                            _indexes.push( index );
                            _ids.push( id );
                        } else {
                            normalisedUpdate.truncateAtFirstGap = true;
                        }
                    }
                }
                if ( _indexes.length ) {
                    var x = composeUpdates( allPreemptives, {
                        removedIndexes: _indexes,
                        removedIds: _ids,
                        addedIndexes: [],
                        addedIds: []
                    }), ll;
                    _indexes = _ids.map( function ( id ) {
                        return x.removedIndexes[ x.removedIds.indexOf( id ) ];
                    });
                    ll = removedIndexes.length;
                    for ( i = 0, l = _indexes.length; i < l; i += 1 ) {
                        removedIndexes[ ll ] = _indexes[i];
                        removedIds[ ll ] = _ids[i];
                        ll += 1;
                    }
                }

                sortLinkedArrays( removedIndexes, removedIds );

                normalisedUpdate.removedIndexes = removedIndexes;
                normalisedUpdate.removedIds = removedIds;

                // Now remove any idempotent operations
                addedIndexes = normalisedUpdate.addedIndexes;
                addedIds = normalisedUpdate.addedIds;
                l = addedIndexes.length;

                while ( l-- ) {
                    id = addedIds[l];
                    i = removedIds.indexOf( id );
                    if ( i > -1 &&
                            removedIndexes[i] - i + l === addedIndexes[l] ) {
                        removedIndexes.splice( i, 1 );
                        removedIds.splice( i, 1 );
                        addedIndexes.splice( l, 1 );
                        addedIds.splice( l, 1 );
                    }
                }

                // 3. We now have a normalised update from the server. We
                // compare this to each composed state of our preemptive
                // updates. If it matches any completely, we guessed correctly
                // and the list is already up to date. We just need to set the
                // status and apply any waiting packets. If it doesn't match, we
                // remove all our preemptive updates and apply the update from
                // the server instead, to ensure we end up in a consistent
                // state.
                if ( !normalisedUpdate.truncateAtFirstGap ) {
                    // If nothing actually changed in this update, we're done,
                    // but we can apply any waiting packets.
                    if ( !removedIds.length && !addedIds.length ) {
                        wasSuccessfulPreemptive = true;
                    } else {
                        l = composed.length;
                        while ( l-- ) {
                            if ( updateIsEqual(
                                    normalisedUpdate, composed[l] ) ) {
                                // Remove the preemptives that have now been
                                // confirmed by the server
                                preemptives.splice( 0, l + 1 );
                                wasSuccessfulPreemptive = true;
                                break;
                            }
                        }
                    }
                }
                if ( wasSuccessfulPreemptive ) {
                    // If we aren't in the dirty state, we shouldn't have any
                    // preemptive updates left. If we do, remove them.
                    if ( !( status & DIRTY ) && preemptives.length ) {
                        allPreemptives = preemptives.reduce( composeUpdates );
                        this._applyUpdate( invertUpdate( allPreemptives ) );
                        preemptives.length = 0;
                    } else {
                        this._applyWaitingPackets();
                    }
                } else {
                    // Undo all preemptive updates and apply server change
                    // instead.
                    preemptives.length = 0;
                    this._applyUpdate(
                        composeUpdates(
                            invertUpdate( allPreemptives ),
                            normalisedUpdate
                        )
                    );
                }
            }
            return this;
        };
    }() ),

    /**
        Method: O.WindowedRemoteQuery#sourceDidFetchIdList

        The source should call this when it fetches a portion of the id list for
        this query. The args object should contain:

        state    - {String} The state of the server when this slice was taken.
        sort     - {*} The sort used.
        filter   - {*} The filter used.
        idList   - {String[]} The list of ids.
        position - {Number} The index in the query of the first id in idList.
        total    - {Number} The total number of records in the query.

        Parameters:
            args - {Object} The portion of the overall id list. See above for
                   details.

        Returns:
            {O.WindowedRemoteQuery} Returns self.
    */
    sourceDidFetchIdList: function ( args ) {
        // User may have changed sort or filter in intervening time; presume the
        // value on the object is the right one, so if data doesn't match, just
        // ignore it.
        if ( !NS.isEqual( args.sort, this.get( 'sort' ) ) ||
                    !NS.isEqual( args.filter, this.get( 'filter' ) ) ) {
                return this;
            }

        var state = this.get( 'state' ),
            status = this.get( 'status' ),
            oldLength = this.get( 'length' ) || 0,
            canGetDeltaUpdates = this.get( 'canGetDeltaUpdates' ),
            position = args.position,
            total = args.total,
            ids = args.idList,
            length = ids.length,
            list = this._list,
            windows = this._windows,
            preemptives = this._preemptiveUpdates,
            informAllRangeObservers = false,
            beginningOfWindowIsFetched = true,
            end, i, l;


        // If the state does not match, the list has changed since we last
        // queried it, so we must get the intervening updates first.
        if ( state && state !== args.state ) {
            if ( canGetDeltaUpdates ) {
                this._waitingPackets.push( args );
                return this.setObsolete().refresh();
            } else {
                list.length = windows.length = preemptives.length = 0;
                informAllRangeObservers = true;
            }
        }
        this.set( 'state', args.state );

        // Need to adjust for preemptive updates
        if ( preemptives.length ) {
            // Adjust ids, position, length
            var allPreemptives = preemptives.reduce( composeUpdates ),
                addedIndexes = allPreemptives.addedIndexes,
                addedIds = allPreemptives.addedIds,
                removedIndexes = allPreemptives.removedIndexes,
                index;

            if ( canGetDeltaUpdates ) {
                l = removedIndexes.length;
                while ( l-- ) {
                    index = removedIndexes[l] - position;
                    if ( index < length ) {
                        if ( index >= 0 ) {
                            ids.splice( index, 1 );
                            length -= 1;
                        } else {
                            position -= 1;
                        }
                    }
                }
                for ( i = 0, l = addedIndexes.length; i < l; i += 1 ) {
                    index = addedIndexes[i] - position;
                    if ( index <= 0 ) {
                        position += 1;
                    } else if ( index < length ) {
                        ids.splice( index, 0, addedIds[i] );
                        length += 1;
                    } else {
                        break;
                    }
                }
                total = allPreemptives.total;
            } else {
                // The preemptive change we made was clearly incorrect as no
                // change has actually occurred, so we need to unwind it.
                this._applyUpdate( invertUpdate( allPreemptives ) );
                preemptives.length = 0;
            }
        }

        // Calculate end index, as length will be destroyed later
        end = position + length;

        // Insert ids into list
        for ( i = 0; i < length; i += 1 ) {
            list[ position + i ] = ids[i];
        }

        // Have we fetched any windows?
        var windowSize = this.get( 'windowSize' ),
            windowIndex = Math.floor( position / windowSize ),
            withinWindowIndex = position % windowSize;
        if ( withinWindowIndex ) {
            for ( i = windowIndex * windowSize, l = i + withinWindowIndex;
                    i < l; i += 1  ) {
                if ( !list[i] ) {
                    beginningOfWindowIsFetched = false;
                    break;
                }
            }
            if ( beginningOfWindowIsFetched ) {
                length += withinWindowIndex;
            } else {
                windowIndex += 1;
                length -= ( windowSize - withinWindowIndex );
            }
        }
        // Now, for each set of windowSize records, we have a complete window.
        while ( ( length -= windowSize ) >= 0 ) {
            windows[ windowIndex ] |= WINDOW_READY;
            windowIndex += 1;
        }
        // Need to check if the final window was loaded (may not be full-sized).
        length += windowSize;
        if ( length && end === total && length === ( total % windowSize ) ) {
            windows[ windowIndex ] |= WINDOW_READY;
        }

        // All that's left is to inform observers of the changes.
        return this
            .beginPropertyChanges()
                .set( 'length', total )
                .set( 'status', (status & EMPTY) ? READY : status )
            .endPropertyChanges()
            .rangeDidChange(
                 informAllRangeObservers ? 0 : position,
                 informAllRangeObservers ?
                     Math.max( oldLength, end ) : end
            )
            .fire( 'query:idsLoaded' );
    },

    sourceWillFetchQuery: function () {
        // If optimise and no longer observed -> remove request
        // Move from requested -> loading
        var windowSize = this.get( 'windowSize' ),
            windows = this._windows,
            isAnExplicitIdFetch = this._isAnExplicitIdFetch,
            indexOfRequested = this._indexOfRequested,
            refreshRequested = this._refresh,
            recordRequests = [],
            idRequests = [],
            optimiseFetching = this.get( 'optimiseFetching' ),
            ranges =  ( NS.meta( this ).rangeObservers || [] ).map(
                function ( observer ) {
                    return observer.range;
                }),
            fetchAllObservedIds = refreshRequested &&
                !this.get( 'canGetDeltaUpdates' ),
            prefetch = this.get( 'prefetch' ),
            i, l, status, inUse, rPrev, iPrev, start;

        this._isAnExplicitIdFetch = false;
        this._indexOfRequested = [];
        this._refresh = false;

        for ( i = 0, l = windows.length; i < l; i += 1 ) {
            status = windows[i];
            if ( status & (WINDOW_REQUESTED|WINDOW_RECORDS_REQUESTED) ) {
                inUse = !optimiseFetching ||
                    windowIsStillInUse( i, windowSize, prefetch, ranges );
                if ( status & WINDOW_RECORDS_REQUESTED ) {
                    status &= ~(WINDOW_RECORDS_REQUESTED);
                    if ( inUse ) {
                        start = i * windowSize;
                        if ( rPrev &&
                                rPrev.start + rPrev.count === start ) {
                            rPrev.count += windowSize;
                        } else {
                            recordRequests.push( rPrev = {
                                start: start,
                                count: windowSize
                            });
                        }
                        status |= WINDOW_LOADING;
                        status |= WINDOW_RECORDS_LOADING;
                    }
                    // If not requesting records and an explicit id fetch, leave
                    // WINDOW_REQUESTED flag set the ids are still requested.
                    if ( inUse || !isAnExplicitIdFetch ) {
                        status &= ~WINDOW_REQUESTED;
                    } else {
                        status |= WINDOW_REQUESTED;
                    }
                }
                if ( status & WINDOW_REQUESTED ) {
                    if ( inUse || isAnExplicitIdFetch ) {
                        start = i * windowSize;
                        if ( iPrev && iPrev.start + iPrev.count === start ) {
                            iPrev.count += windowSize;
                        } else {
                            idRequests.push( iPrev = {
                                start: start,
                                count: windowSize
                            });
                        }
                        status |= WINDOW_LOADING;
                    }
                    status &= ~WINDOW_REQUESTED;
                }
            } else if ( fetchAllObservedIds ) {
                inUse = windowIsStillInUse( i, windowSize, prefetch, ranges );
                if ( inUse ) {
                    start = i * windowSize;
                    if ( iPrev && iPrev.start + iPrev.count === start ) {
                        iPrev.count += windowSize;
                    } else {
                        idRequests.push( iPrev = {
                            start: start,
                            count: windowSize
                        });
                    }
                }
            }
            windows[i] = status;
        }

        if ( refreshRequested || this.is( EMPTY ) ) {
            this.set( 'status',
                ( this.get( 'status' )|LOADING ) & ~(OBSOLETE|DIRTY) );
        }

        return {
            ids: idRequests,
            records: recordRequests,
            indexOf: indexOfRequested,
            refresh: refreshRequested,
            callback: function () {
                this._windows = this._windows.map( function ( status ) {
                    return status & ~(WINDOW_LOADING|WINDOW_RECORDS_LOADING);
                });
                this.set( 'status', this.get( 'status' ) & ~LOADING );
            }.bind( this )
        };
    }
});

NS.WindowedRemoteQuery = WindowedRemoteQuery;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RecordAttribute.js                                                   \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Record.js                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var instanceOf = function ( value, Type ) {
    switch ( typeof value ) {
        case 'string':
            return Type === String;
        case 'boolean':
            return Type === Boolean;
        case 'number':
            return Type === Number;
    }
    return value instanceof Type;
};

/**
    Class: O.RecordAttribute

    Represents an attribute on a record.
*/
var RecordAttribute = NS.Class({

    __setupProperty__: function ( metadata, propKey, object ) {
        var attrs = metadata.attrs,
            dependents;
        if ( !metadata.hasOwnProperty( 'attrs' ) ) {
            attrs = metadata.attrs = attrs ? Object.create( attrs ) : {};
        }
        if ( this.isPrimaryKey ) {
            object.constructor.primaryKey = propKey;
            // Make the `id` property depend on the primary key.
            dependents = metadata.dependents;
            if ( !metadata.hasOwnProperty( 'dependents' ) ) {
                dependents = metadata.dependents = NS.clone( dependents );
                metadata.allDependents = {};
            }
            ( dependents[ propKey ] ||
                ( dependents[ propKey ] = [] ) ).push( 'id' );
        }
        attrs[ this.key || propKey ] = propKey;
    },

    __teardownProperty__: function ( metadata, propKey ) {
        metadata.attrs[ this.key || propKey ] = null;
    },

    /**
        Constructor: O.RecordAttribute

        Parameters:
            mixin - {Object} (optional) Override the default properties.
    */
    init: function ( mixin ) {
        NS.extend( this, mixin );
    },

    /**
        Property (private): O.RecordAttribute#isProperty
        Type: Boolean
        Default: true

        Record attributes are computed properties.
    */
    isProperty: true,
    /**
        Property (private): O.RecordAttribute#isVolatile
        Type: Boolean
        Default: false

        Record attributes should be cached.
    */
    isVolatile: false,
    /**
        Property (private): O.RecordAttribute#isSilent
        Type: Boolean
        Default: true

        Store will handle firing computedPropertyIsChanged on record.
    */
    isSilent: true,

    /**
        Property: O.RecordAttribute#noSync
        Type: Boolean
        Default: false

        If set to true, changes will not be propagated back to the source.
    */
    noSync: false,

    /**
        Property: O.RecordAttribute#Type
        Type: Constructor
        Default: null

        If a type is set and it has a fromJSON method, this will be used to
        convert values from the underlying data object when the attribute is
        fetched.
    */
    Type: null,

    /**
        Property: O.RecordAttribute#isNullable
        Type: Boolean
        Default: true

        If false, attempts to set null for the value will throw an error.
    */
    isNullable: true,

    /**
        Property: O.RecordAttribute#key
        Type: {String|null}
        Default: null

        The key to use on the JSON object for this attribute. If not set, will
        use the same key as the property name on the record.
    */
    key: null,

    /**
        Property: O.RecordAttribute#isPrimaryKey
        Type: Boolean
        Default: true

        If true, this is the primary key for the record.
    */
    isPrimaryKey: false,

    /**
        Method: O.RecordAttribute#willSet

        This function is used to check the value being set is permissible. By
        default, it checks that the value is not null (or the <#isNullable>
        property is true), and that the value is of the correct type (if the
        <#Type> property is set). An error is thrown if the value is of a
        different type.

        You could override this function to, for example, only allow values that
        pass a strict validation to be set.

        Parameters:
            propValue - {*} The value being set.
            propKey   - {String} The name of the attribute.

        Returns:
            {Boolean} May the value be set?
    */
    willSet: function ( propValue, propKey, record ) {
        if ( !record.get( 'isEditable' ) ) {
            return false;
        }
        if ( propValue === null ) {
            if ( !this.isNullable ) {
                return false;
            }
        }
        else if ( this.Type && !instanceOf( propValue, this.Type ) ) {
            throw new Error( "Incorrect value type for record attribute" );
        }
        return true;
    },

    /**
        Property: O.RecordAttribute#defaultValue
        Type: *
        Default: undefined

        If the attribute is not set on the underlying data object, the
        defaultValue will be returned instead. This will also be used to add
        this attribute to the data object if a new record is created and the
        attribute is not set.

        The value should be of the type specified in <O.RecordAttribute#Type>.
    */
    defaultValue: undefined,

    /**
        Method: O.RecordAttribute#validate

        Tests whether the value to be set is valid.

        Parameters:
            propValue   - {*} The value being set. This is the real value, not
                          the serialised version for JSON (if different).
            propKey     - {String} The name of the attribute on the record.
            record      - {O.Record} The record on which the value is being set.

        Returns:
            {O.ValidationError} An object describing the error if this is not a
            valid value for the attribute. Otherwise, returns null if the value
            is valid.
    */
    validate: null,

    /**
        Property: O.RecordAttribute#validityDependencies
        Type: String[]|null
        Default: null

        Other attributes the validity depends on. The attribute will be
        revalidated if any of these attributes change. Note, chained
        dependencies are not automatically calculated; you must explicitly state
        all dependencies.

        NB. This is a list of the names of the attributes as used on the
        objects, not necessarily that of the underlying keys used in the JSON
        data object.
    */
    validityDependencies: null,

    /**
        Method: O.RecordAttribute#call

        Gets/sets the attribute.

        Parameters:
            record    - {O.Record} The record the attribute is being set on or
                        got from.
            propValue - {*} The value being set (undefined if just a 'get').
            propKey   - {String} The name of the attribute on the record.

        Returns:
            {*} The attribute.
    */
    call: function ( record, propValue, propKey ) {
        var store = record.get( 'store' ),
            storeKey = record.get( 'storeKey' ),
            data = storeKey ? store.getData( storeKey ) : record._data,
            attrKey, attrValue, currentAttrValue, update, Type;
        if ( data ) {
            attrKey = this.key || propKey;
            currentAttrValue = data[ attrKey ];
            if ( propValue !== undefined &&
                    this.willSet( propValue, propKey, record ) ) {
                attrValue = propValue && propValue.toJSON ?
                    propValue.toJSON() : propValue;
                if ( !NS.isEqual( attrValue, currentAttrValue ) ) {
                    if ( storeKey ) {
                        update = {};
                        update[ attrKey ] = attrValue;
                        store.updateData( storeKey, update,
                            !( this.noSync || record._noSync ) );
                        store.fire( 'record:user:update', { record: this } );
                    } else {
                        data[ attrKey ] = attrValue;
                        record.computedPropertyDidChange( propKey );
                        if ( this.validate ) {
                            record.get( 'errorForAttribute' ).set( propKey,
                                this.validate( propValue, propKey, record ) );
                        }
                    }
                }
                return propValue;
            }
            Type = this.Type;
        }
        return currentAttrValue !== undefined ?
            currentAttrValue !== null && Type && Type.fromJSON ?
                Type.fromJSON( currentAttrValue ) : currentAttrValue :
            this.defaultValue;
    }
});

NS.RecordAttribute = RecordAttribute;

/**
    Function: O.Record.attr

    A factory function for creating a new <O.RecordAttribute> instance. This
    will set an assert function to verify the correct type is being set whenever
    the value is set, and that the correct type is used to serialise to/from
    primitive types.

    When subclassing O.Record, use this function to create a value for any
    properties on the record which correspond to properties on the underlying
    data object. This will automatically set things up so they are fetched from
    the store and synced to the source.

    Parameters:
        Type    - {Constructor} The type of the property.
        mixin - {Object} Properties to pass to the <O.RecordAttribute>
                constructor.

    Returns:
        {O.RecordAttribute} Getter/setter for that record attribute.
*/
NS.Record.attr = function ( Type, mixin ) {
    if ( !mixin ) { mixin = {}; }
    if ( Type && !mixin.Type ) { mixin.Type = Type; }
    return new RecordAttribute( mixin );
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ToManyAttribute.js                                                   \\
// Module: DataStore                                                          \\
// Requires: RecordAttribute.js                                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var slice = Array.prototype.slice;

var RecordArray = NS.Class({

    Extends: NS.ObservableArray,

    init: function ( record, propKey, value, Type ) {
        this.record = record;
        this.propKey = propKey;
        this.Type = Type;
        this.store = record.get( 'store' );

        this._updatingStore = false;

        RecordArray.parent.init.call( this, value && value.slice() );

        record.addObserverForKey( propKey, this, 'updateListFromRecord' );
    },

    destroy: function () {
        this.get( 'record' ).removeObserverForKey(
            this.get( 'propKey' ), this, 'updateListFromRecord' );
        RecordArray.parent.destroy.call( this );
    },

    toJSON: function () {
        return this._array.slice();
    },

    updateListFromRecord: function () {
        if ( !this._updatingStore ) {
            var record = this.get( 'record' ),
                propKey = this.get( 'propKey' ),
                list = record[ propKey ].getRaw( record, propKey );

            this.set( '[]', list ? list.slice() : [] );
        }
    },

    getObjectAt: function ( index ) {
        var storeKey = RecordArray.parent.getObjectAt.call( this, index );
        return storeKey ?
            this.get( 'store' )
                .getRecord( this.get( 'Type' ), '#' + storeKey ) :
            null;
    },

    setObjectAt: function ( index, value ) {
        this.replaceObjectsAt( index, 1, [ value ] );
        return this;
    },

    replaceObjectsAt: function ( index, numberRemoved, newItems ) {
        newItems = newItems ? slice.call( newItems ) : [];

        var record = this.get( 'record' ),
            propKey = this.get( 'propKey' ),
            Type = this.get( 'Type' ),
            store = this.get( 'store' ),
            oldItems = RecordArray.parent.replaceObjectsAt.call(
                this, index, numberRemoved, newItems.map( function ( record ) {
                    return record.get( 'storeKey' );
                })
            ).map( function ( storeKey ) {
                return store.getRecord( Type, '#' + storeKey );
            });

        this._updatingStore = true;
        record[ propKey ].setRaw( record, propKey, this._array.slice() );
        this._updatingStore = false;

        return oldItems;
    },

    add: function ( record ) {
        var index = this._array.indexOf( record.get( 'storeKey' ) );
        if ( index === -1 ) {
            this.replaceObjectsAt(
                this.get( 'length' ), 0, [ record ] );
        }
        return this;
    },

    remove: function ( record ) {
        var index = this._array.indexOf( record.get( 'storeKey' ) );
        if ( index > -1 ) {
            this.replaceObjectsAt( index, 1 );
        }
        return this;
    }
});

var ToManyAttribute = NS.Class({

    Extends: NS.RecordAttribute,

    Type: Array,
    recordType: null,

    call: function ( record, _, propKey ) {
        var arrayKey = '_' + propKey + 'RecordArray';
        return record[ arrayKey ] || ( record[ arrayKey ] =
            new RecordArray( record, propKey, ToManyAttribute.parent.call.call(
                this, record, undefined, propKey ), this.recordType )
        );
    },

    getRaw: function ( record, propKey ) {
        return ToManyAttribute.parent.call.call(
            this, record, undefined, propKey );
    },

    setRaw: function ( record, propKey, data ) {
        return ToManyAttribute.parent.call.call(
            this, record, data, propKey );
    }
});

NS.ToManyAttribute = ToManyAttribute;

NS.Record.toMany = function ( mixin ) {
    return new ToManyAttribute( mixin );
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ToOneAttribute.js                                                    \\
// Module: DataStore                                                          \\
// Requires: RecordAttribute.js                                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var ToOneAttribute = NS.Class({

    Extends: NS.RecordAttribute,

    willSet: function ( propValue, propKey, record ) {
        if ( ToOneAttribute.parent.willSet.call(
                this, propValue, propKey, record ) ) {
            if ( propValue && !propValue.get( 'storeKey' ) ) {
                throw new Error( 'O.ToOneAttribute: ' +
                    'Cannot set connection to record not saved to store.' );
            }
            return true;
        }
        return false;
    },

    call: function ( record, propValue, propKey ) {
        var result = ToOneAttribute.parent.call.call(
            this, record, propValue, propKey );
        if ( result && typeof result === 'string' ) {
            result = record.get( 'store' ).getRecord( this.Type, '#' + result );
        }
        return result || null;
    }
});

NS.ToOneAttribute = ToOneAttribute;

NS.Record.toOne = function ( mixin ) {
    return new ToOneAttribute( mixin );
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ValidationError.js                                                   \\
// Module: DataStore                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.ValidationError

    Represents an error in an attribute value of a record.

    Parameters:
        type        - {Number} The error code.
        explanation - {String} A description of the error (normally used to
                      present to the user).
*/
var ValidationError = function ( type, explanation ) {
    this.type = type;
    this.explanation = explanation;
};

ValidationError.REQUIRED = 1;
ValidationError.TOO_SHORT = 2;
ValidationError.TOO_LONG = 4;
ValidationError.INVALID_CHAR = 8;
ValidationError.FIRST_CUSTOM_ERROR = 16;

NS.ValidationError = ValidationError;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Source.js                                                            \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.Source

    Extends: O.Object

    A source provides persistent storage for a set of records. Data is fetched
    and commited back to here by an instance of <O.Store>.
*/
var Source = NS.Class({

    Extends: NS.Object,

    // ---

    /**
        Method: O.Source#fetchRecord

        Fetches a particular record from the source

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecord: function (/* Type, id, callback */) {
        return false;
    },

    /**
        Method: O.Source#fetchAllRecords

        Fetches all records of a particular type from the source. If a state
        token is supplied, the server may, if it is able to, only return the
        changes since that state.

        Parameters:
            Type     - {O.Class} The record type.
            state    - {(String|undefined)} The current state in the store.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchAllRecords: function (/* Type, state, callback */) {
        return false;
    },

    /**
        Method: O.Source#refreshRecord

        Fetches any new data for a previously fetched record. If not overridden,
        this method just calls <O.Source#fetchRecord>.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       refresh completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the refresh.
    */
    refreshRecord: function ( Type, id, callback ) {
        return this.fetchRecord( Type, id, callback );
    },

    /**
        Method: O.Source#fetchQuery

        Fetches the data for a remote query from the source.

        Parameters:
            query - {O.RemoteQuery} The query to fetch.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchQuery: function (/* query, callback */) {
        return false;
    },

    /**
        Method: O.Source#commitChanges

        Commits a set of creates/updates/destroys to the source. These are
        specified in a single object, which has record type names as keys and an
        object with create/update/destroy properties as values.

        A changedMap, is a map of attribute names to a boolean value indicating
        whether that value has actually changed. Any properties in the data
        which are not in the changed map are presumed unchanged.

        An example call might look like:

            source.commitChanges({
                MyType: {
                    primaryKey: "id",
                    create: {
                        storeKeys: [ "sk1", "sk2" ],
                        records: [{ attr: val, attr2: val2 ...}, {...}]
                    },
                    update: {
                        storeKeys: [ "sk3", "sk4", ... ],
                        records: [{ id: "id3", attr: val ... }, {...}],
                        changes: [{ attr: true }, ... ]
                    },
                    destroy: {
                        storeKeys: [ "sk5", "sk6" ],
                        ids: [ "id5", "id6" ]
                    },
                    state: "i425m515233"
                },
                MyOtherType: {
                    ...
                }
            });

        Any types that are handled by the source are removed from the changes
        object (`delete changes[ typeName ]`); any unhandled types are left
        behind, so the object may be passed to several sources, with each
        handling their own types.

        Parameters:
            changes  - {Object} The creates/updates/destroys to commit.
            callback - {Function} (optional) A callback to make after the
                       changes have been committed.

        Returns:
            {Boolean} Returns true if any of the types were handled. The
            callback will only be called if the source is handling at least one
            of the types being committed.
    */
    commitChanges: function (/* changes, callback */) {
        return false;
    }
});

NS.Source = Source;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: AggregateSource.js                                                   \\
// Module: DataStore                                                          \\
// Requires: Source.js                                                        \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.AggregateSource

    An O.AggregateSource instance can be used to collect several <O.Source>
    instances together to present to an instance of <O.Store>. Each method call
    on an aggregate source is passed around the sources it is managing until it
    finds one that can handle it.
*/
var AggregateSource = NS.Class({

    Extends: NS.Source,

    init: function ( mixin ) {
        this.sources = [];
        AggregateSource.parent.init.call( this, mixin );
    },

    /**
        Property: O.AggregateSource#sources
        Type: O.Source[]

        List of sources to pass requests to. Will be tried in order.
    */

    /**
        Method: O.AggregateSource#addSource

        Parameters:
            source - {O.Source} The source to add to the end of the list of
                     aggregated sources.

        Returns:
            {O.AggregateSource} Returns self.
    */
    addSource: function ( source ) {
        source.set( 'store', this.get( 'store' ) );
        this.get( 'sources' ).push( source );
        return this;
    },

    /**
        Method: O.AggregateSource#removeSource

        Parameters:
            source - {O.Source} The source to remove from the list of aggregated
                     sources.

        Returns:
            {O.AggregateSource} Returns self.
    */
    removeSource: function ( source ) {
        this.get( 'sources' ).erase( source );
        return this;
    },

    storeWasSet: function () {
        var store = this.get( 'store' );
        this.sources.forEach( function ( source ) {
            source.set( 'store', store );
        });
    }.observes( 'store' ),

    fetchRecord: function ( Type, id, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.fetchRecord( Type, id, callback );
        });
    },

    fetchAllRecords: function ( Type, state, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.fetchAllRecords( Type, state, callback );
        });
    },

    refreshRecord: function ( Type, id, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.refreshRecord( Type, id, callback );
        });
    },

    commitChanges: function ( changes, callback ) {
        var waiting = 0,
            callbackAfterAll;
        if ( callback ) {
            callbackAfterAll = function () {
                if ( !( waiting-= 1 ) ) {
                    callback();
                }
            };
        }
        this.get( 'sources' ).forEach( function ( source ) {
            if ( source.commitChanges( changes, callbackAfterAll ) ) {
                waiting += 1;
            }
        });
        return this;
    },

    fetchQuery: function ( query, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.fetchQuery( query, callback );
        });
    }
});

NS.AggregateSource = AggregateSource;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Store.js                                                             \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Record.js                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/**
    Module: DataStore

    The DataStore module provides classes for managing the CRUD lifecycle of
    data records.
*/

( function ( NS ) {

// Same as O.Status, inlined here for efficiency

// Core states:
var EMPTY        =   1;
var READY        =   2;
var DESTROYED    =   4;
var NON_EXISTENT =   8;
// Properties:
var LOADING      =  16; // Request in progress to fetch record or updates
var COMMITTING   =  32; // Request in progress to commit record
var NEW          =  64; // Record is not created on source (has no source id)
var DIRTY        = 128; // Record has local changes not yet committing
var OBSOLETE     = 256; // Record may have changes not yet requested

// ---

// Error messages.
var Status = NS.Status;
var CANNOT_CREATE_EXISTING_RECORD_ERROR =
        'O.Store Error: Cannot create existing record',
    CANNOT_WRITE_TO_UNREADY_RECORD_ERROR =
        'O.Store Error: Cannot write to unready record',
    FETCHED_IS_DESTROYED_OR_NON_EXISTENT_ERROR =
        'O.Store Error: Record loaded which has status destroyed or non-existent',
    SOURCE_COMMIT_CREATE_MISMATCH_ERROR =
        'O.Store Error: Source committed a create on a record not marked new',
    SOURCE_COMMIT_DESTROY_MISMATCH_ERROR =
        'O.Store Error: Source commited a destroy on a record not marked destroyed';

// ---

var sk = 1;
var generateStoreKey = function () {
    return 'k' + ( sk++ );
};

// ---

var filter = function ( accept, storeKey ) {
    return accept( this._skToData[ storeKey ], this, storeKey );
};

var sort = function ( compare, a, b ) {
    var _skToData = this._skToData,
        aIsFirst = compare( _skToData[ a ], _skToData[ b ], this );
    return aIsFirst || ( ~~a.slice( 1 ) - ~~b.slice( 1 ) );
};

// ---

var isEqual = NS.isEqual;
var guid = NS.guid;
var invoke = NS.RunLoop.invoke.bind( NS.RunLoop );

// ---

var typeToForeignRefAttrs = {};

var getForeignRefAttrs = function ( Type ) {
    var typeId = guid( Type );
    var foreignRefAttrs = typeToForeignRefAttrs[ typeId ];
    var proto, attrs, attrKey, propKey, attribute;
    if ( !foreignRefAttrs ) {
        proto = Type.prototype;
        attrs = NS.meta( proto ).attrs;
        foreignRefAttrs = [];
        for ( attrKey in attrs ) {
            propKey = attrs[ attrKey ];
            attribute = proto[ propKey ];
            if ( attribute instanceof NS.ToOneAttribute ) {
                foreignRefAttrs.push([ attrKey, 1, attribute.Type ]);
            }
            if ( attribute instanceof NS.ToManyAttribute ) {
                foreignRefAttrs.push([ attrKey, 0, attribute.recordType ]);
            }
        }
        typeToForeignRefAttrs[ typeId ] = foreignRefAttrs;
    }
    return foreignRefAttrs;
};

var toStoreKey = function ( store, Type, id ) {
    return store.getStoreKey( Type, id );
};

var convertForeignKeysToSK = function ( store, foreignRefAttrs, data ) {
    var i, l, foreignRef, attrKey, AttrType, value;
    for ( i = 0, l = foreignRefAttrs.length; i < l; i += 1 ) {
        foreignRef = foreignRefAttrs[i];
        attrKey = foreignRef[0];
        AttrType = foreignRef[2];
        if ( attrKey in data ) {
            value = data[ attrKey ];
            data[ attrKey ] = value && ( foreignRef[1] === 1 ?
                toStoreKey( store, AttrType, value ) :
                value.map( toStoreKey.bind( null, store, AttrType ) )
            );
        }
    }
};

var toId = function ( store, storeKey ) {
    return store.getIdFromStoreKey( storeKey ) || '#' + storeKey;
};

var convertForeignKeysToId = function ( store, Type, data ) {
    var foreignRefAttrs = getForeignRefAttrs( Type ),
        result = data,
        i, l, foreignRef, attrKey, value;
    for ( i = 0, l = foreignRefAttrs.length; i < l; i += 1 ) {
        foreignRef = foreignRefAttrs[i];
        attrKey = foreignRef[0];
        if ( attrKey in data ) {
            if ( result === data ) {
                result = NS.clone( data );
            }
            value = data[ attrKey ];
            result[ attrKey ] = value && ( foreignRef[1] === 1 ?
                toId( store, value ) :
                value.map( toId.bind( null, store ) )
            );
        }
    }
    return result;
};

// ---

/**
    Class: O.Store

    A Store is used to keep track of all records in the model. It provides
    methods for retrieving single records or lists based on queries.

    Principles:
    * Records are never locked: you can always edit or destroy a READY record,
      even when it is committing another change.
    * A record never has more than one change in flight to the server at once.
      If it is currently committing, any further change must wait for the
      previous commit to succeed/fail before being committed to the server.
    * A record is always in exactly one of the core states:
      - `EMPTY`: No information is known about the record.
      - `READY`: The record is loaded in memory. You may read, update or
        destroy it.
      - `DESTROYED`: The record has been destroyed. (This may not have been
        committed to the server yet; see below).
      - `NON_EXISTENT`: No record with the requested id exists.
    * A record may additionally have one or more of the following status bits
      set:
      - `LOADING`: A request is in progress to fetch the record's data
        (or update the data if the record is already in memory).
      - `COMMITTING`: A request is in progress to commit a change to the record.
      - `NEW`: The record is not yet created on the source (and therefore has
         no source id).
      - `DIRTY`: The record has local changes not yet committing.
      - `OBSOLETE`: The record may have changes on the server not yet requested.
*/
var Store = NS.Class({

    Mixin: NS.EventTarget,

    /**
        Property: O.Store#autoCommit
        Type: Boolean
        Default: true

        If true, the store will automatically commit any changes at the end of
        the RunLoop in which they are made.
    */
    autoCommit: true,

    /**
        Property: O.Store#rebaseConflicts
        Type: Boolean
        Default: true

        If true, in the event that new data is loaded for a dirty record, the
        store will apply the changes made to the previous committed state on top
        of the current committed state, rather than just discarding the changes.
    */
    rebaseConflicts: true,

    /**
        Property: O.Store#isNested
        Type: Boolean

        Is this a nested store?
    */
    isNested: false,

    /**
        Constructor: O.Store

        Parameters:
            source - {O.Source} The source for this store.
    */
    init: function ( mixin ) {
        // Map store key -> record
        this._skToRecord = {};
        // Map store key -> data
        this._skToData = {};
        // Map store key -> status
        this._skToStatus = {};
        // Map store key -> Type
        this._skToType = {};
        // Map Type -> store key -> id
        this._typeToSkToId = {};
        // Map Type -> id -> store key
        this._typeToIdToSk = {};
        // Map store key -> property key -> bool (isChanged)
        this._skToChanged = {};
        // Map store key -> last committed data
        this._skToCommitted = {};
        // Map store key -> last committed data (whilst committing)
        this._skToRollback = {};

        // Map store key -> last access timestamp for memory manager
        this._skToLastAccess = {};

        // Set of store keys for created records
        this._created = {};
        // Set of store keys for destroyed records
        this._destroyed = {};

        // Queries
        // Map id -> query
        this._idToQuery = {};
        // Map Type -> list of local queries
        this._liveQueries = {};
        // Set of remote queries.
        this._remoteQueries = [];
        // List of types needing a refresh.
        this._queryTypesNeedRefresh = [];

        // List of nested stores
        this._nestedStores = [];

        // Type -> [ store key ] of changed records.
        this._typeToChangedSks = {};

        // READY      -> Some records of type loaded
        // LOADING    -> Loading or refreshing ALL records of type
        // COMMITTING -> Committing some records of type
        this._typeToStatus = {};
        // Type -> state string for type in client
        this._typeToClientState = {};
        // Type -> latest known state string for type on server
        // If committing or loading type, wait until finish to check
        this._typeToServerState = {};

        this._commitCallbacks = [];

        NS.extend( this, mixin );

        mixin.source.set( 'store', this );
    },

    // === Nested Stores =======================================================

    /**
        Method: O.Store#addNested

        Registers a new nested store. Automatically called by the
        <O.NestedStore> constructor; there should be no need to do it manually.

        Parameters:
            store - {O.NestedStore} The new nested store.

        Returns:
            {O.Store} Returns self.
    */
    addNested: function ( store ) {
        this._nestedStores.push( store );
        return this;
    },

    /**
        Method: O.Store#removeNested

        Deregisters a nested store previously registered with addNested.
        Automatically called by <O.NestedStore#destroy>; there should be no need
        to call this method manually.

        Parameters:
            store - {O.NestedStore} The nested store to deregister.

        Returns:
            {O.Store} Returns self.

    */
    removeNested: function ( store ) {
        this._nestedStores.erase( store );
        return this;
    },

    // === Get/set Ids =========================================================

    /**
        Method: O.Store#getStoreKey

        Returns the store key for a particular record type and record id. This
        is guaranteed to be the same for that tuple until the record is unloaded
        from the store. If no id is supplied, a new store key is always
        returned.

        Parameters:
            Type - {O.Class} The constructor for the record type.
            id   - {String} (optional) The id of the record.

        Returns:
            {String} Returns the store key for that record type and id.
    */
    getStoreKey: function ( Type, id ) {
        var typeId = guid( Type ),
            idToSk = ( this._typeToIdToSk[ typeId ] ||
                ( this._typeToIdToSk[ typeId ] = {} ) ),
            skToId = ( this._typeToSkToId[ typeId ] ||
                ( this._typeToSkToId[ typeId ] = {} ) ),
            storeKey = id && idToSk[ id ];

        if ( !storeKey ) {
            storeKey = generateStoreKey();
            this._skToType[ storeKey ] = Type;
            skToId[ storeKey ] = id;
            if ( id ) {
                idToSk[ id ] = storeKey;
            }
        }
        return storeKey;
    },

    /**
        Method: O.Store#getIdFromStoreKey

        Get the record id for a given store key.

        Parameters:
            storeKey - {String} The store key to get the record id for.

        Returns:
            {(String|undefined)} Returns the id for the record, of undefined if
            the store key was not found or does not have an id (normally because
            the server assigns ids and the record has not yet been committed).
    */
    getIdFromStoreKey: function ( storeKey ) {
        var Type = this._skToType[ storeKey ];
        return Type &&
            ( this._typeToSkToId[ guid( Type ) ] || {} )[ storeKey ];
    },

    // === Client API ==========================================================

    /**
        Method: O.Store#getRecordStatus

        Returns the status value for a given record type and id.

        Parameters:
            Type - {O.Class} The record type.
            id   - {String} The record id.

        Returns:
            {O.Status} The status in this store of the given record.
    */
    getRecordStatus: function ( Type, id ) {
        var _idToSk = this._typeToIdToSk[ guid( Type ) ];
        return _idToSk ? this.getStatus( _idToSk[ id ] ) : EMPTY;
    },

    /**
        Method: O.Store#getRecord

        Returns a record object for a particular type and id, creating it if it
        does not already exist and fetching its value if not already loaded in
        memory, unless the doNotFetch parameter is set.

        Parameters:
            Type       - {O.Class} The record type.
            id         - {String} The record id, or the store key prefixed with
                         a '#'.
            doNotFetch - {Boolean} (optional) If true, the record data will not
                         be fetched from the server if it is not already loaded.

        Returns:
            {O.Record|null} Returns the requested record, or null if no type or
            no id given.
    */
    getRecord: function ( Type, id, doNotFetch ) {
        if ( !Type || !id ) { return null; }
        var storeKey = ( id.charAt( 0 ) === '#' ) ?
                id.slice( 1 ) : this.getStoreKey( Type, id ),
            record = this.materialiseRecord( storeKey, Type );

        // If the caller is already handling the fetching, they can
        // set doNotFetch to true.
        if ( !doNotFetch && this.getStatus( storeKey ) === EMPTY ) {
            this.fetchData( storeKey );
        }
        // Add timestamp for memory manager.
        this._skToLastAccess[ storeKey ] = Date.now();
        return record;
    },

    /**
        Method: O.Store#getOne

        Returns the first loaded record that matches an acceptance function.

        Parameters:
            Type   - {O.Class} The constructor for the record type to find.
            filter - {Function} (optional) An acceptance function. This will be
                     passed the raw data object (*not* a record instance) and
                     should return true if the record is the desired one, or
                     false otherwise.

        Returns:
            {(O.Record|null)} The matching record, or null if none found.
    */
    getOne: function ( Type, filter ) {
        var storeKey = this.findOne( Type, filter );
        return storeKey ? this.materialiseRecord( storeKey, Type ) : null;
    },

    /**
        Method: O.Store#getAll

        Returns a record array of records with data loaded for a particular
        type, optionally filtered and/or sorted.

        Parameters:
            Type   - {O.Class} The constructor for the record type being
                     queried.
            filter - {Function} (optional) An acceptance function. This will be
                     passed the raw data object (*not* a record instance) and
                     should return true if the record should be included, or
                     false otherwise.
            sort   - {Function} (optional) A comparator function. This will be
                     passed the raw data objects (*not* record instances) for
                     two records. It should return -1 if the first record should
                     come before the second, 1 if the inverse is true, or 0 if
                     they should have the same position.

        Returns:
            {O.RecordArray} A record array of results.
    */
    getAll: function ( Type, filter, sort ) {
        var storeKeys = this.findAll( Type, filter, sort );
        return new NS.RecordArray( this, Type, storeKeys );
    },

    /**
        Method: O.Store#hasChanges

        Returns:
            {Boolean} Are there any changes in the store?
    */
    hasChanges: function () {
        var storeKey;
        for ( storeKey in this._created ) {
            return true;
        }
        for ( storeKey in this._skToChanged ) {
            return true;
        }
        for ( storeKey in this._destroyed ) {
            return true;
        }
        return false;
    },

    /**
        Method: O.Store#commitChanges

        Commits any outstanding changes (created/updated/deleted records) to the
        source. Will only invoke once per run loop, even if called multiple
        times.

        Parameters:
            callback - {Function} (optional) A callback to be made after the
                       source has finished committing the changes.

        Returns:
            {O.Store} Returns self.
    */
    commitChanges: function ( callback ) {
        if ( callback ) {
            this._commitCallbacks.push( callback );
        }
        NS.RunLoop.queueFn( 'middle', this._commitChanges, this );
    },
    _commitChanges: function () {
        this.fire( 'willCommit' );
        var _created = this._created,
            _destroyed = this._destroyed,
            _skToData = this._skToData,
            _skToStatus = this._skToStatus,
            _skToType = this._skToType,
            _typeToSkToId = this._typeToSkToId,
            _skToChanged = this._skToChanged,
            _skToCommitted = this._skToCommitted,
            _skToRollback = this._skToRollback,
            _typeToClientState = this._typeToClientState,
            _typeToStatus = this._typeToStatus,
            storeKey, data, Type, changed, id, status, create, update, destroy,
            newSkToChanged = {},
            newDestroyed = {},
            changes = {},
            commitCallbacks = this._commitCallbacks,
            types = {};

        var getEntry = function ( Type ) {
            var typeId = guid( Type ),
                idPropKey, idAttrKey,
                entry = changes[ typeId ];
            if ( !entry ) {
                idPropKey = Type.primaryKey || 'id';
                idAttrKey = Type.prototype[ idPropKey ].key || idPropKey;
                entry = changes[ typeId ] = {
                    primaryKey: idAttrKey,
                    create: { storeKeys: [], records: [] },
                    update: { storeKeys: [], records: [], changes: [] },
                    destroy: { storeKeys: [], ids: [] },
                    state: _typeToClientState[ typeId ]
                };
                // TODO: should we not allow commits for a type if a commit
                // is already in progress and the type has a state string?
                _typeToStatus[ typeId ] |= COMMITTING;
                types[ typeId ] = Type;
            }
            return entry;
        };

        for ( storeKey in _created ) {
            status = _skToStatus[ storeKey ];
            Type = _skToType[ storeKey ];
            data = _skToData[ storeKey ];

            data = convertForeignKeysToId( this, Type, data );

            create = getEntry( Type ).create;
            create.storeKeys.push( storeKey );
            create.records.push( data );
            this.setStatus( storeKey, ( status & ~DIRTY ) | COMMITTING );
        }
        for ( storeKey in _skToChanged ) {
            status = _skToStatus[ storeKey ];
            Type = _skToType[ storeKey ];
            data = _skToData[ storeKey ];

            changed = _skToChanged[ storeKey ];
            if ( status & COMMITTING ) {
                newSkToChanged[ storeKey ] = changed;
                continue;
            }
            _skToRollback[ storeKey ] = _skToCommitted[ storeKey ];
            delete _skToCommitted[ storeKey ];
            data = convertForeignKeysToId( this, Type, data );

            update = getEntry( Type ).update;
            update.storeKeys.push( storeKey );
            update.records.push( data );
            update.changes.push( changed );
            this.setStatus( storeKey, ( status & ~DIRTY ) | COMMITTING );
        }
        for ( storeKey in _destroyed ) {
            status = _skToStatus[ storeKey ];
            Type = _skToType[ storeKey ];
            id = _typeToSkToId[ guid( Type ) ][ storeKey ];

            // This means it's new and committing, so wait for commit to finish
            // first.
            if ( status & NEW ) {
                newDestroyed[ storeKey ] = 1;
                continue;
            }

            destroy = getEntry( Type ).destroy;
            destroy.storeKeys.push( storeKey );
            destroy.ids.push( id );
            this.setStatus( storeKey, ( status & ~DIRTY ) | COMMITTING );
        }

        this._skToChanged = newSkToChanged;
        this._created = {};
        this._destroyed = newDestroyed;
        this._commitCallbacks = [];

        this.source.commitChanges( changes, function () {
            commitCallbacks.forEach( invoke );
            for ( var typeId in types ) {
                _typeToStatus[ typeId ] &= ~COMMITTING;
                this._checkServerStatus( types[ typeId ] );
            }
        }.bind( this ) );

        this.fire( 'didCommit' );
    },

    /**
        Method: O.Store#discardChanges

        Discards any outstanding changes (created/updated/deleted records),
        reverting the store to the last known committed state.

        Returns:
            {O.Store} Returns self.
    */
    discardChanges: function () {
        var _created = this._created,
            _destroyed = this._destroyed,
            _skToChanged = this._skToChanged,
            _skToCommitted = this._skToCommitted,
            storeKey;

        for ( storeKey in _created ) {
            this.destroyRecord( storeKey );
        }
        for ( storeKey in _skToChanged ) {
            this.updateData( storeKey, _skToCommitted[ storeKey ], true );
        }
        for ( storeKey in _destroyed ) {
            this.undestroyRecord( storeKey );
        }

        this._created = {};
        this._destroyed = {};

        return this;
    },

    getInverseChanges: function () {
        var _created = this._created,
            _destroyed = this._destroyed,
            _skToType = this._skToType,
            _skToData = this._skToData,
            _skToChanged = this._skToChanged,
            _skToCommitted = this._skToCommitted,
            inverse = {
                create: [],
                update: [],
                destroy: []
            },
            storeKey, Type;

        for ( storeKey in _created ) {
            inverse.destroy.push( storeKey );
        }
        for ( storeKey in _skToChanged ) {
            Type = _skToType[ storeKey ];
            inverse.update.push([
                storeKey,
                Object.filter(
                    _skToCommitted[ storeKey ], _skToChanged[ storeKey ]
                )
            ]);
        }
        for ( storeKey in _destroyed ) {
            Type = _skToType[ storeKey ];
            inverse.create.push([
                storeKey,
                Type,
                NS.clone( _skToData[ storeKey ] )
            ]);
        }

        return inverse;
    },

    applyChanges: function ( changes ) {
        var create = changes.create,
            update = changes.update,
            destroy = changes.destroy,
            createObj, updateObj,
            i, l, storeKey, Type, data;

        for ( i = 0, l = create.length; i < l; i += 1 ) {
            createObj = create[i];
            storeKey = createObj[0];
            Type = createObj[1];
            data = createObj[2];
            this.undestroyRecord( storeKey, Type, data );
        }
        for ( i = 0, l = update.length; i < l; i += 1 ) {
            updateObj = update[i];
            storeKey = updateObj[0];
            data = updateObj[1];
            this.updateData( storeKey, data, true );
        }
        for ( i = 0, l = destroy.length; i < l; i += 1 ) {
            storeKey = destroy[i];
            this.destroyRecord( storeKey );
        }
    },

    // === Low level (primarily internal) API: uses storeKey ===================

    /**
        Method: O.Store#getTypeStatus

        Get the status of a type

        Parameters:
            Type - {O.Class} The record type.

        Returns:
            {O.Status} The status of the type in the store.
    */
    getTypeStatus: function ( Type ) {
        return this._typeToStatus[ guid( Type ) ] || EMPTY;
    },

    /**
        Method: O.Store#getTypeState

        Get the current client state token for a type.

        Parameters:
            Type - {O.Class} The record type.

        Returns:
            {String|null} The client's current state token for the type.
    */
    getTypeState: function ( Type ) {
        return this._typeToClientState[ guid( Type ) ] || null;
    },

    /**
        Method: O.Store#getStatus

        Get the status of a record with a given store key.

        Parameters:
            storeKey - {String} The store key of the record.

        Returns:
            {O.Status} The status of the record with that store key.
    */
    getStatus: function ( storeKey ) {
        return this._skToStatus[ storeKey ] || EMPTY;
    },

    /**
        Method: O.Store#setStatus

        Set the status of a record with a given store key.

        Parameters:
            storeKey - {String} The store key of the record.
            status   - {O.Status} The new status for the record.

        Returns:
            {O.Store} Returns self.
    */
    setStatus: function ( storeKey, status ) {
        var previousStatus = this.getStatus( storeKey ),
            record = this._skToRecord[ storeKey ];
        if ( previousStatus !== status ) {
            this._skToStatus[ storeKey ] = status;
            // wasReady !== isReady
            if ( ( previousStatus ^ status ) & READY ) {
                this._recordDidChange( storeKey );
            }
            if ( record ) {
                record.propertyDidChange( 'status', previousStatus, status );
            }
            this._nestedStores.forEach( function ( store ) {
                store.parentDidChangeStatus( storeKey, previousStatus, status );
            });
        }
        return this;
    },

    /**
        Method: O.Store#setRecordForStoreKey

        Sets the record instance for a store key.

        Parameters:
            storeKey - {String} The store key of the record.
            record   - {O.Record} The record.

        Returns:
            {O.Store} Returns self.
    */
    setRecordForStoreKey: function ( storeKey, record ) {
        this._skToRecord[ storeKey ] = record;
        return this;
    },

    /**
        Method: O.Store#materialiseRecord

        Returns the record object for a given store key, creating it if this is
        the first time it has been requested.

        Parameters:
            storeKey - {String} The store key of the record.
            Type     - {O.Class} The record type.

        Returns:
            {O.Record} Returns the requested record.
    */
    materialiseRecord: function ( storeKey, Type ) {
        return this._skToRecord[ storeKey ] ||
            ( this._skToRecord[ storeKey ] = new Type( this, storeKey ) );
    },

    /**
        Method: O.Store#mayUnloadRecord

        Called before unloading a record from memory. Checks the record is in a
        clean state and does not have any observers and that every nested store
        also has no objection to unloading the record.

        Parameters:
            storeKey - {String} The store key of the record.

        Returns:
            {Boolean} True if the store may unload the record.
    */
    mayUnloadRecord: function ( storeKey ) {
        var record = this._skToRecord[ storeKey ],
            status = this.getStatus( storeKey );
        // Only unload unwatched clean, non-committing records.
        if ( ( status & (COMMITTING|NEW|DIRTY) ) ||
                ( ( status & READY ) && record && record.hasObservers() ) ) {
            return false;
        }
        return this._nestedStores.every( function ( store ) {
            return store.mayUnloadRecord( storeKey );
        });
    },

    /**
        Method: O.Store#willUnloadRecord

        Called just before the record is removed from memory. If the record has
        been instantiated it will call <O.Record#storeWillUnload>. The method is
        then recursively called on nested stores.

        Parameters:
            storeKey - {String} The store key of the record being unloaded.

        Returns:
            {O.Store} Returns self.
    */
    willUnloadRecord: function ( storeKey ) {
        var record = this._skToRecord[ storeKey ];
        if ( record ) {
            record.storeWillUnload();
        }
        this._nestedStores.forEach( function ( store ) {
            store.willUnloadRecord( storeKey );
        });
        return this;
    },

    /**
        Method: O.Store#unloadRecord

        Unloads everything about a record from the store, freeing up memory,
        providing it is safe to do so. Will have no effect if
        <O.Store#mayUnloadRecord> returns false for the given store key.

        Parameters:
            storeKey - {String} The store key of the record to be unloaded.

        Returns:
            {Boolean} Was the record unloaded?
    */
    unloadRecord: function ( storeKey ) {
        if ( !this.mayUnloadRecord( storeKey ) ) {
            return false;
        }
        this.willUnloadRecord( storeKey );

        var typeId = guid( this._skToType[ storeKey ] ),
            id = this._typeToSkToId[ typeId ][ storeKey ];

        delete this._skToRecord[ storeKey ];
        delete this._skToData[ storeKey ];
        delete this._skToStatus[ storeKey ];
        delete this._skToType[ storeKey ];
        delete this._skToRollback[ storeKey ];
        delete this._typeToSkToId[ typeId ][ storeKey ];
        if ( id ) {
            delete this._typeToIdToSk[ typeId ][ id ];
        }
        delete this._skToLastAccess[ storeKey ];
        return true;
    },

    /**
        Method: O.Store#createRecord

        Creates a new record with the given store key. The existing status for
        the store key must be <O.Status.EMPTY>. An initial data object may be
        passed as a second argument. The new record will be committed back to
        the server the next time <O.Store#commitChanges> runs.

        You will not normally use this method; instead just create a new record
        using `new ORecordSubclass()` and then call <O.Record#saveToStore>.

        Parameters:
            storeKey - {String} The store key of the new record.
            data     - {Object} (optional) The initial data for the record.

        Returns:
            {O.Store} Returns self.
    */
    createRecord: function ( storeKey, data ) {
        var status = this.getStatus( storeKey );
        if ( status !== EMPTY && status !== DESTROYED ) {
            NS.RunLoop.didError({
                name: CANNOT_CREATE_EXISTING_RECORD_ERROR,
                message:
                    '\nStatus: ' +
                        ( Object.keyOf( Status, status ) || status ) +
                    '\nData: ' + JSON.stringify( data )
            });
            return this;
        }

        this._created[ storeKey ] = 1;
        this._skToData[ storeKey ] = data || {};

        this.setStatus( storeKey, (READY|NEW|DIRTY) );

        if ( this.autoCommit ) {
            this.commitChanges();
        }

        return this;
    },

    /**
        Method: O.Store#destroyRecord

        Marks a record as destroyed and commits this back to the server when
        O.Store#commitChanges next runs. If the record is new it is immediately
        unloaded from memory, otherwise the store waits until the destroy has
        been committed.

        You will not normally use this method; instead just call
        <O.Record#destroy> on the record object itself.

        Parameters:
            storeKey - {String} The store key of the record to be destroyed.

        Returns:
            {O.Store} Returns self.
    */
    destroyRecord: function ( storeKey ) {
        var status = this.getStatus( storeKey );
        // If created -> just remove from created.
        if ( status === (READY|NEW|DIRTY) ) {
            delete this._created[ storeKey ];
            this.setStatus( storeKey, DESTROYED );
            this.unloadRecord( storeKey );
        } else if ( status & READY ) {
            // Discard changes if dirty.
            if ( status & DIRTY ) {
                this.setData( storeKey, this._skToCommitted[ storeKey ] );
                delete this._skToCommitted[ storeKey ];
                delete this._skToChanged[ storeKey ];
                if ( this.isNested ) {
                    delete this._skToData[ storeKey ];
                }
            }
            this._destroyed[ storeKey ] = 1;
            // Maintain COMMITTING flag so we know to wait for that to finish
            // before committing the destroy.
            // Maintain NEW flag as we have to wait for commit to finish (so we
            // have an id) before we can destroy it.
            // Maintain OBSOLETE flag in case we have to roll back.
            this.setStatus( storeKey,
                DESTROYED|DIRTY|( status & (COMMITTING|NEW|OBSOLETE) ) );
            if ( this.autoCommit ) {
                this.commitChanges();
            }
        }
        return this;
    },

    undestroyRecord: function ( storeKey, Type, data ) {
        var status = this.getStatus( storeKey ),
            idPropKey, idAttrKey;
        if ( status === EMPTY || status === DESTROYED ) {
            idPropKey = Type.primaryKey || 'id';
            idAttrKey = Type.prototype[ idPropKey ].key || idPropKey;
            delete data[ idAttrKey ];
            this._skToType[ storeKey ] = Type;
            this.createRecord( storeKey, data );
        } else if ( ( status & ~(OBSOLETE|LOADING) ) ===
                (DESTROYED|COMMITTING) ) {
            this.setStatus( storeKey, READY|NEW|COMMITTING );
        } else if ( status & DESTROYED ) {
            delete this._destroyed[ storeKey ];
            this.setStatus( storeKey, ( status & ~(DESTROYED|DIRTY) ) | READY );
        }
    },

    // ---

    /**
        Method: O.Store#sourceStateDidChange

        Call this method to notify the store of a change in the state of a
        particular record type in the source. The store will wait for any
        loading or committing of this type to finish, then check its state. If
        it doesn't match, it will then request updates.

        Parameters:
            Type     - {O.Class} The record type.
            newState - {String} The new state on the server.

        Returns:
            {O.Store} Returns self.
    */
    sourceStateDidChange: function ( Type, newState ) {
        var typeId = guid( Type ),
            clientState = this._typeToClientState[ typeId ],
            _remoteQueries = this._remoteQueries,
            l = _remoteQueries.length,
            remoteQuery;

        if ( clientState && newState !== clientState ) {
            if ( !( this._typeToStatus[ typeId ] & (LOADING|COMMITTING) ) ) {
                while ( l-- ) {
                    remoteQuery = _remoteQueries[l];
                    if ( remoteQuery.get( 'Type' ) === Type ) {
                        remoteQuery.setObsolete();
                    }
                }
                this.fetchAll( Type, true );
            } else {
                this._typeToServerState[ typeId ] = newState;
            }
        }

        return this;
    },

    /**
        Method (private): O.Store#_checkServerStatus

        Called internally when a type finishes loading or committing, to check
        if there's a server state update to process.

        Parameters:
            Type - {O.Class} The record type.
    */
    _checkServerStatus: function ( Type ) {
        var typeId = guid( Type ),
            serverState = this._typeToServerState[ typeId ];
        if ( serverState ) {
            delete this._typeToServerState[ typeId ];
            this.sourceStateDidChange( Type, serverState );
        }
    },

    /**
        Method: O.Store#fetchAll

        Fetches all records of a given type from the server, or if already
        fetched updates the set of records.

        Parameters:
            Type  - {O.Class} The type of records to fetch.
            force - {Boolean} (optional) Fetch even if we have a state string.

        Returns:
            {O.Store} Returns self.
    */
    fetchAll: function ( Type, force ) {
        var typeId = guid( Type ),
            status = this._typeToStatus[ typeId ],
            state = this._typeToClientState[ typeId ];

        if ( !( status & LOADING ) && ( !state || force ) ) {
            this.source.fetchAllRecords( Type, state, function () {
                this._typeToStatus[ typeId ] &= ~LOADING;
                this._checkServerStatus( Type );
            }.bind( this ));
            this._typeToStatus[ typeId ] = ( status | LOADING );
        }
        return this;
    },

    // ---

    /**
        Method: O.Store#fetchData

        Fetches the data for a given record from the server.

        Parameters:
            storeKey - {String} The store key of the record to fetch.

        Returns:
            {O.Store} Returns self.
    */
    fetchData: function ( storeKey ) {
        var status = this.getStatus( storeKey );

        // Nothing to do if already loading or new, destroyed or non-existant.
        if ( status & (LOADING|NEW|DESTROYED|NON_EXISTENT) ) {
            return this;
        }
        var Type = this._skToType[ storeKey ],
            typeId = guid( Type ),
            id = this._typeToSkToId[ typeId ][ storeKey ];
        if ( status & EMPTY ) {
            this.source.fetchRecord( Type, id );
            this.setStatus( storeKey, (EMPTY|LOADING) );
        } else {
            this.source.refreshRecord( Type, id );
            this.setStatus( storeKey, ( status & ~OBSOLETE ) | LOADING );
        }
        return this;
    },

    /**
        Method: O.Store#getData

        Returns the current data object in memory for the given record

        Parameters:
            storeKey - {String} The store key for the record.

        Returns:
            {Object|undefined} The record data, if loaded.
    */
    getData: function ( storeKey ) {
        return this._skToData[ storeKey ];
    },

    /**
        Method: O.Store#setData

        Sets the data object for a given record.

        Parameters:
            storeKey      - {String} The store key for the record.
            data          - {Object} The new data object for the record.

        Returns:
            {O.Store} Returns self.
    */
    setData: function ( storeKey, data ) {
        if ( this.getStatus( storeKey ) & READY ) {
            this.updateData( storeKey, data, false );
        } else {
            var changedKeys = Object.keys( data );
            this._skToData[ storeKey ] = data;
            this._notifyRecordOfChanges( storeKey, changedKeys );
            this._nestedStores.forEach( function ( store ) {
                store.parentDidSetData( storeKey, changedKeys );
            });
        }
        return this;
    },

    /**
        Method: O.Store#updateData

        Updates the data object for a given record with the supplied attributes.

        Parameters:
            storeKey      - {String} The store key for the record.
            data          - {Object} An object of new attribute values for the
                            record.
            changeIsDirty - {Boolean} Should the change be committed back to the
                            server?

        Returns:
            {Boolean} Was the data actually written? Will be false if the
            changeIsDirty flag is set but the current data is not yet loaded
            into memory.
    */
    updateData: function ( storeKey, data, changeIsDirty ) {
        var status = this.getStatus( storeKey ),
            _skToData = this._skToData,
            _skToCommitted = this._skToCommitted,
            _skToChanged = this._skToChanged,
            current = _skToData[ storeKey ],
            changedKeys = [],
            seenChange = false,
            Type, key, value, oldValue, committed, changed;

        if ( !( status & READY ) ) {
            Type = this._skToType[ storeKey ];
            NS.RunLoop.didError({
                name: CANNOT_WRITE_TO_UNREADY_RECORD_ERROR,
                message:
                    '\nStatus: ' +
                        ( Object.keyOf( Status, status ) || status ) +
                    '\nData: ' + JSON.stringify( data )
            });
            return false;
        }

        // Copy-on-write for nested stores.
        if ( this.isNested && !_skToData.hasOwnProperty( storeKey ) ) {
            _skToData[ storeKey ] = current = NS.clone( current );
        }

        if ( changeIsDirty && status !== (READY|NEW|DIRTY) ) {
            committed = _skToCommitted[ storeKey ] ||
                ( _skToCommitted[ storeKey ] = NS.clone( current ) );
            changed = _skToChanged[ storeKey ] ||
                ( _skToChanged[ storeKey ] = {} );

            for ( key in data ) {
                value = data[ key ];
                oldValue = current[ key ];
                if ( !isEqual( value, oldValue ) ) {
                    current[ key ] = value;
                    changedKeys.push( key );
                    changed[ key ] = !isEqual( value, committed[ key ] );
                    seenChange = seenChange || changed[ key ];
                }
            }
            // If we just reset properties to their committed values, we should
            // check to see if there are any changes remaining.
            if ( !seenChange ) {
                for ( key in changed ) {
                    if ( changed[ key ] ) {
                        seenChange = true;
                        break;
                    }
                }
            }
            // If there are still changes remaining, set the DIRTY flag and
            // commit. Otherwise, remove the DIRTY flag and reset state.
            if ( seenChange ) {
                this.setStatus( storeKey, status | DIRTY );
                if ( this.autoCommit ) {
                    this.commitChanges();
                }
            } else {
                this.setStatus( storeKey, status & ~DIRTY );
                delete _skToCommitted[ storeKey ];
                delete _skToChanged[ storeKey ];
                if ( this.isNested ) {
                    delete _skToData[ storeKey ];
                }
            }
        } else {
            for ( key in data ) {
                value = data[ key ];
                oldValue = current[ key ];
                if ( !isEqual( value, oldValue ) ) {
                    current[ key ] = value;
                    changedKeys.push( key );
                }
            }
        }

        this._notifyRecordOfChanges( storeKey, changedKeys );
        this._nestedStores.forEach( function ( store ) {
            store.parentDidUpdateData( storeKey, changedKeys );
        });
        this._recordDidChange( storeKey );
        return true;
    },

    /**
        Method: O.Store#revertData

        Reverts the data object for a given record to the last committed state.

        Parameters:
            storeKey - {String} The store key for the record.

        Returns:
            {O.Store} Returns self.
    */
    revertData: function ( storeKey ) {
        var committed = this._skToCommitted[ storeKey ];
        if ( committed ) {
            this.updateData( storeKey, committed, true );
        }
        return this;
    },

    /**
        Method (private): O.Store#_notifyRecordOfChanges

        Triggers change notifications if this record has an instantiated
        instance, and informs nested stores so they can do likewise.

        Parameters:
            storeKey    - {String} The store key of the record with changes.
            changedKeys - {Array} A list of the properties which have changed.

        Returns:
            {O.Store} Returns self.
    */
    _notifyRecordOfChanges: function ( storeKey, changedKeys ) {
        var record = this._skToRecord[ storeKey ],
            l = changedKeys.length,
            attrs, attrKey, propKey, attribute, errorForAttribute;
        if ( record ) {
            attrs = NS.meta( record ).attrs;
            record.beginPropertyChanges();
            while ( l-- ) {
                attrKey = changedKeys[l];
                propKey = attrs[ attrKey ];
                // Server may return more data than is defined in the record;
                // ignore the rest.
                if ( !propKey ) {
                    // Special case: implicit id attribute
                    if ( attrKey === 'id' ) {
                        propKey = attrKey;
                    } else {
                        continue;
                    }
                }
                attribute = record[ propKey ];
                record.computedPropertyDidChange( propKey );
                if ( attribute.validate ) {
                    if ( !errorForAttribute ) {
                        errorForAttribute = record.get( 'errorForAttribute' );
                    }
                    errorForAttribute.set( propKey, attribute.validate(
                        record.get( propKey ), propKey, record )
                    );
                }
            }
            record.endPropertyChanges();
        }
        return this;
    },

    // === Source callbacks ====================================================

    /**
        Method: O.Store#sourceDidFetchRecords

        Callback made by the <O.Source> object associated with this store when
        it fetches some records from the server.

        Parameters:
            Type    - {O.Class} The record type.
            records - {Object[]} Array of data objects.
            state   - {String} (optional) The state of the record type on the
                      server.
            isAll   - {Boolean} This is all the records of this type on the
                      server.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidFetchRecords: function ( Type, records, state, isAll ) {
        var typeId = guid( Type ),
            _typeToClientState = this._typeToClientState,
            oldState,
            l = records.length,
            idPropKey = Type.primaryKey || 'id',
            idAttrKey = Type.prototype[ idPropKey ].key || idPropKey,
            now = Date.now(),
            seen = {},
            updates = {},
            foreignRefAttrs = getForeignRefAttrs( Type ),
            data, id, storeKey, status;

        while ( l-- ) {
            data = records[l];
            id = data[ idAttrKey ];
            seen[ id ] = true;
            storeKey = this.getStoreKey( Type, id );
            status = this.getStatus( storeKey );

            if ( foreignRefAttrs.length ) {
                convertForeignKeysToSK( this, foreignRefAttrs, data );
            }

            // If we already have the record loaded, process it as an update.
            if ( status & READY ) {
                updates[ id ] = data;
            }
            // We're in the middle of destroying it. Update the data in case
            // we need to roll back.
            else if ( ( status & DESTROYED ) &&
                    ( status & (DIRTY|COMMITTING) ) ) {
                this._skToData[ storeKey ] = data;
                this.setStatus( storeKey, status & ~LOADING );
            }
            // Anything else is new.
            else {
                // Shouldn't have been able to fetch a destroyed or non-existent
                // record. Smells like an error: log it.
                if ( !( status & EMPTY ) ) {
                    NS.RunLoop.didError({
                        name: FETCHED_IS_DESTROYED_OR_NON_EXISTENT_ERROR,
                        message:
                            '\nStatus: ' +
                                ( Object.keyOf( Status, status ) || status ) +
                            '\nId: ' + id
                    });
                    // Set status back to empty so setData works.
                    this.setStatus( storeKey, EMPTY );
                }
                this.setData( storeKey, data );
                this.setStatus( storeKey, READY );
                this._skToLastAccess[ storeKey ] = now;
            }
        }

        if ( isAll ) {
            var _idToSk = this._typeToIdToSk[ guid( Type ) ],
                destroyed = [];
            for ( id in _idToSk ) {
                if ( !seen[ id ] ) {
                    destroyed.push( id );
                }
            }
            if ( destroyed.length ) {
                this.sourceDidDestroyRecords( Type, destroyed );
            }
        }

        this.sourceDidFetchPartialRecords( Type, updates, true );

        if ( state ) {
            oldState = _typeToClientState[ typeId ];
            // If the state has changed, we need to fetch updates, but we can
            // still load these records
            if ( !isAll && oldState && oldState !== state ) {
                this.sourceStateDidChange( Type, state );
            } else {
                _typeToClientState[ typeId ] = state;
            }
        }
        this._typeToStatus[ typeId ] |= READY;

        NS.RunLoop.queueFn( 'middle',
            this.liveQueriesAreReady.bind( this, Type ) );

        return this;
    },

    /**
        Method: O.Store#sourceDidFetchPartialRecords

        Callback made by the <O.Source> object associated with this store when
        it has fetched some updates to records which may be loaded in the store.
        An update is a subset of a normal data object for the given record type,
        containing only the attributes which have changed since the previous
        state.

        Parameters:
            Type    - {O.Class} The record type.
            updates - {Object} An object mapping record id to an object of
                      changed attributes.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidFetchPartialRecords: function ( Type, updates, _idsAreSKs ) {
        var typeId = guid( Type ),
            _skToData = this._skToData,
            _skToStatus = this._skToStatus,
            _idToSk = this._typeToIdToSk[ typeId ] || {},
            _skToId = this._typeToSkToId[ typeId ] || {},
            _skToChanged = this._skToChanged,
            _skToCommitted = this._skToCommitted,
            idPropKey = Type.primaryKey || 'id',
            idAttrKey = Type.prototype[ idPropKey ].key || idPropKey,
            foreignRefAttrs = _idsAreSKs ? [] : getForeignRefAttrs( Type ),
            id, storeKey, status, update, newId;

        for ( id in updates ) {
            storeKey = _idToSk[ id ];
            status = _skToStatus[ storeKey ];
            update = updates[ id ];

            // Can't update an empty or destroyed record.
            if ( !( status & READY ) ) {
                continue;
            }

            // If OBSOLETE, the record may have changed since the fetch was
            // initiated. Since we don't want to overwrite any preemptive
            // changes, ignore this data and fetch it again.
            // Similarly if the record is committing, we don't know for sure
            // what state the update was applied on top of, so fetch again
            // to be sure.
            if ( status & (COMMITTING|OBSOLETE) ) {
                this.setStatus( storeKey, status & ~LOADING );
                this.fetchData( storeKey );
                continue;
            }

            if ( foreignRefAttrs.length ) {
                convertForeignKeysToSK( this, foreignRefAttrs, update );
            }

            if ( status & DIRTY ) {
                // If we have a conflict we can either rebase on top, or discard
                // our local changes.
                update = NS.extend( _skToCommitted[ storeKey ], update );
                if ( this.rebaseConflicts ) {
                    var oldData = _skToData[ storeKey ],
                        oldChanged = _skToChanged[ storeKey ],
                        newData = {},
                        newChanged = {},
                        clean = true,
                        key;
                    // Every key in here must be reapplied on top, even if
                    // changed[key] === false, as this means it's been
                    // changed then changed back.
                    for ( key in oldData ) {
                        if ( key in oldChanged ) {
                            if ( !isEqual( oldData[ key ], update[ key ] ) ) {
                                newChanged[ key ] = true;
                                clean = false;
                            }
                            newData[ key ] = oldData[ key ];
                        } else {
                            newData[ key ] = update[ key ];
                        }
                    }
                    if ( !clean ) {
                        _skToChanged[ storeKey ] = newChanged;
                        _skToCommitted[ storeKey ] = update;
                        this.setData( storeKey, newData );
                        this.setStatus( storeKey, (READY|DIRTY) );
                        continue;
                    }
                }
                delete _skToChanged[ storeKey ];
                delete _skToCommitted[ storeKey ];
            }

            newId = update[ idAttrKey ];
            if ( newId && newId !== id ) {
                _skToId[ storeKey ] = newId;
                delete _idToSk[ id ];
                _idToSk[ newId ] = storeKey;
            }

            this.updateData( storeKey, update, false );
            this.setStatus( storeKey, READY );
        }
        return this;
    },

    /**
        Method: O.Store#sourceCouldNotFindRecords

        Callback made by the <O.Source> object associated with this store when
        it has been asked to fetch certain record ids and the server has
        responded that the records do not exist.

        Parameters:
            Type   - {O.Class} The record type.
            idList - {String[]} The list of ids of non-existent requested
                     records.

        Returns:
            {O.Store} Returns self.
    */
    sourceCouldNotFindRecords: function ( Type, idList ) {
        var l = idList.length,
            _skToCommitted = this._skToCommitted,
            _skToChanged = this._skToChanged,
            storeKey, status;

        while ( l-- ) {
            storeKey = this.getStoreKey( Type, idList[l] );
            status = this.getStatus( storeKey );
            if ( status & EMPTY ) {
                this.setStatus( storeKey, NON_EXISTENT );
            } else {
                if ( status & DIRTY ) {
                    this.setData( storeKey, _skToCommitted[ storeKey ] );
                    delete _skToCommitted[ storeKey ];
                    delete _skToChanged[ storeKey ];
                }
                this.setStatus( storeKey, DESTROYED );
                this.unloadRecord( storeKey );
            }
        }
        return this;
    },

    // ---

    /**
        Method: O.Store#sourceDidFetchUpdates

        Callback made by the <O.Source> object associated with this store when
        it fetches the ids of all records of a particular type that have been
        created/modified/destroyed of a particular since the client's state.

        Parameters:
            Type     - {O.Class} The record type.
            changed  - {String[]} List of ids for records which have been
                       added or changed in the store since oldState.
            removed  - {String[]} List of ids for records which have been
                       destroyed in the store since oldState.
            oldState - {String} The state these changes are from.
            newState - {String} The state these changes are to.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidFetchUpdates: function ( Type, changed, removed, oldState, newState ) {
        var typeId = guid( Type );
        if ( this._typeToClientState[ typeId ] === oldState ) {
            if ( changed ) {
                this.sourceDidModifyRecords( Type, changed );
            }
            if ( removed ) {
                this.sourceDidDestroyRecords( Type, removed );
            }
            this._typeToClientState[ typeId ] = newState;
        } else {
            this.sourceStateDidChange( Type, newState );
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidModifyRecords

        Callback made by the <O.Source> object associated with this store when
        some records may be out of date.

        Parameters:
            Type   - {O.Class} The record type.
            idList - {String[]} Array of record ids for records of the
                     given type which have updates available on the server.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidModifyRecords: function ( Type, idList ) {
        var _skToStatus = this._skToStatus,
            _idToSk = this._typeToIdToSk[ guid( Type ) ] || {},
            l = idList.length,
            storeKey, status;

        while ( l-- ) {
            storeKey = _idToSk[ idList[l] ];
            status = _skToStatus[ storeKey ];
            if ( status & READY ) {
                this.setStatus( storeKey, status | OBSOLETE );
            }
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidDestroyRecords

        Callback made by the <O.Source> object associated with this store when
        the source has destroyed records (not in response to a commit request
        by the client).

        Parameters:
            Type   - {O.Class} The record type.
            idList - {String[]} The list of ids of records which have been
                     destroyed.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidDestroyRecords: function ( Type, idList ) {
        var l = idList.length,
            storeKey;

        while ( l-- ) {
            storeKey = this.getStoreKey( Type, idList[l] );
            this.setStatus( storeKey, DESTROYED );
            this.unloadRecord( storeKey );
        }
        return this;
    },

    // ---

    /**
        Method: O.Store#sourceCommitDidChangeState

        Callback made by the <O.Source> object associated with this store when
        it finishes committing a record type which uses state tokens to stay in
        sync with the server.

        Parameters:
            Type     - {O.Class} The record type.
            oldState - {String} The state before the commit.
            newState - {String} The state after the commit.

        Returns:
            {O.Store} Returns self.
    */
    sourceCommitDidChangeState: function ( Type, oldState, newState ) {
        var typeId = guid( Type ),
            _typeToClientState = this._typeToClientState;

        if ( _typeToClientState[ typeId ] === oldState ) {
            _typeToClientState[ typeId ] = newState;
        } else {
            delete this._typeToServerState[ typeId ];
            this.sourceStateDidChange( Type, newState );
        }

        return this;
    },

    // ---

    /**
        Method: O.Store#sourceDidCommitCreate

        Callback made by the <O.Source> object associated with this store when
        the source commits the creation of records as requested by a call to
        <O.Source#commitChanges>.

        Parameters:
            skToId - {Object} A map of the store key to the record id for all
            newly created records.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidCommitCreate: function ( skToPartialData ) {
        var _skToType = this._skToType,
            _typeToSkToId = this._typeToSkToId,
            _typeToIdToSk = this._typeToIdToSk,
            storeKey, status, data, Type, typeId, idPropKey, idAttrKey, id;
        for ( storeKey in skToPartialData ) {
            status = this.getStatus( storeKey );
            if ( status & NEW ) {
                data = skToPartialData[ storeKey ];

                Type = _skToType[ storeKey ];
                typeId = guid( Type );
                idPropKey = Type.primaryKey || 'id';
                idAttrKey = Type.prototype[ idPropKey ].key || idPropKey;
                id = data[ idAttrKey ];

                // Set id internally
                _typeToSkToId[ typeId ][ storeKey ] = id;
                _typeToIdToSk[ typeId ][ id ] = storeKey;

                // Notify record, and update with any other data
                this.updateData( storeKey, data, false );
                this.setStatus( storeKey, status & ~(COMMITTING|NEW) );
            } else {
                NS.RunLoop.didError({
                    name: SOURCE_COMMIT_CREATE_MISMATCH_ERROR
                });
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidNotCreate

        Callback made by the <O.Source> object associated with this store when
        the source does not commit the creation of some records as requested
        by a call to <O.Source#commitChanges>.

        If the condition is temporary (for example a precondition fail, such as
        the server being in a different state to the client) then the store
        will attempt to recommit the changes the next time commitChanges is
        called (or at the end of the current run loop if `autoCommit` is
        `true`); it is presumed that the precondition will be fixed before then.

        If the condition is permanent (as indicated by the `isPermanent`
        argument), the store will revert to the last known committed state,
        i.e. it will destroy the new record. If an `errors` array is passed,
        the store will first fire a `record:commit:error` event on the
        record (including in nested stores), if already instantiated. If
        <NS.Event#preventDefault> is called on the event object, the record
        will **not** be reverted; it is up to the handler to then fix the record
        before it is recommitted.

        Parameters:
            storeKeys   - {String[]} The list of store keys of records for
                          which the creation was not committed.
            isPermanent - {Boolean} (optional) Should the store try to commit
                          the changes again, or just revert to last known
                          committed state?
            errors      - {Object[]} (optional) An array of objects
                          representing the error in committing the store key in
                          the equivalent location in the *storeKeys* argument.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidNotCreate: function ( storeKeys, isPermanent, errors ) {
        var l = storeKeys.length,
            _skToCommitted = this._skToCommitted,
            _skToChanged = this._skToChanged,
            _created = this._created,
            storeKey, status;

        while ( l-- ) {
            storeKey = storeKeys[l];
            status = this.getStatus( storeKey );
            if ( status & DESTROYED ) {
                this.setStatus( storeKey, DESTROYED );
                this.unloadRecord( storeKey );
            }
            else {
                if ( status & DIRTY ) {
                    delete _skToCommitted[ storeKey ];
                    delete _skToChanged[ storeKey ];
                }
                this.setStatus( storeKey, (READY|NEW|DIRTY) );
                _created[ storeKey ] = 1;
                if ( isPermanent && errors &&
                        !this._notifyRecordOfError( storeKey, errors[l] ) ) {
                    this.destroyRecord( storeKey );
                }
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidCommitUpdate

        Callback made by the <O.Source> object associated with this store when
        the source commits updates to some records as requested by a call to
        <O.Source#commitChanges>.

        Parameters:
            storeKeys - {String[]} The list of store keys of records for
                        which the submitted updates have been committed.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidCommitUpdate: function ( storeKeys ) {
        var l = storeKeys.length,
            _skToRollback = this._skToRollback,
            storeKey, status;

        while ( l-- ) {
            storeKey = storeKeys[l];
            status = this.getStatus( storeKey );
            delete _skToRollback[ storeKey ];
            if ( status !== EMPTY ) {
                this.setStatus( storeKey, status & ~COMMITTING );
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidNotUpdate

        Callback made by the <O.Source> object associated with this store when
        the source does not commit the updates to some records as requested
        by a call to <O.Source#commitChanges>.

        If the condition is temporary (for example a precondition fail, such as
        the server being in a different state to the client) then the store
        will attempt to recommit the changes the next time commitChanges is
        called (or at the end of the current run loop if `autoCommit` is
        `true`); it is presumed that the precondition will be fixed before then.

        If the condition is permanent (as indicated by the `isPermanent`
        argument), the store will revert to the last known committed state.
        If an `errors` array is passed, the store will first fire a
        `record:commit:error` event on the record (including in nested stores),
        if already instantiated. If <NS.Event#preventDefault> is called on the
        event object, the record will **not** be reverted; it is up to the
        handler to then fix the record before it is recommitted.

        Parameters:
            storeKeys   - {String[]} The list of store keys of records for
                          which the update was not committed.
            isPermanent - {Boolean} (optional) Should the store try to commit
                          the changes again, or just revert to last known
                          committed state?
            errors      - {Object[]} (optional) An array of objects
                          representing the error in committing the store key in
                          the equivalent location in the *storeKeys* argument.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidNotUpdate: function ( storeKeys, isPermanent, errors ) {
        var l = storeKeys.length,
            _skToData = this._skToData,
            _skToChanged = this._skToChanged,
            _skToCommitted = this._skToCommitted,
            _skToRollback = this._skToRollback,
            storeKey, status, committed, current, key, changed;

        while ( l-- ) {
            storeKey = storeKeys[l];
            status = this.getStatus( storeKey );
            // If destroyed now, but still in memory, revert the data so
            // that if the destroy fails we still have the right data.
            if ( ( status & DESTROYED ) && _skToRollback[ storeKey ] ) {
                _skToData[ storeKey ] = _skToRollback[ storeKey ];
                delete _skToRollback[ storeKey ];
            }
            // Other than that, we don't care about unready records
            if ( !( status & READY ) ) {
                // But make sure we know it's no longer committing.
                if ( status !== EMPTY ) {
                    this.setStatus( storeKey, status & ~COMMITTING );
                }
                continue;
            }
            committed = _skToCommitted[ storeKey ] = _skToRollback[ storeKey ];
            delete _skToRollback[ storeKey ];
            changed = {};
            current = _skToData[ storeKey ];
            delete _skToChanged[ storeKey ];
            for ( key in current ) {
                if ( !isEqual( current[ key ], committed[ key ] ) ) {
                    changed[ key ] = true;
                    _skToChanged[ storeKey ] = changed;
                }
            }
            if ( _skToChanged[ storeKey ] ) {
                this.setStatus( storeKey, ( status & ~COMMITTING )|DIRTY );
            } else {
                this.setStatus( storeKey, ( status & ~COMMITTING ) );
            }
            if ( isPermanent && errors &&
                    !this._notifyRecordOfError( storeKey, errors[l] ) ) {
                this.revertData( storeKey );
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidCommitDestroy

        Callback made by the <O.Source> object associated with this store when
        the source commits the destruction of some records as requested by a
        call to <O.Source#commitChanges>.

        Parameters:
            storeKeys - {String[]} The list of store keys of records whose
                        destruction has been committed.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidCommitDestroy: function ( storeKeys ) {
        var l = storeKeys.length,
            storeKey, status;
        while ( l-- ) {
            storeKey = storeKeys[l];
            status = this.getStatus( storeKey );
            // If the record has been undestroyed while being committed
            // it will no longer be in the destroyed state, but instead be
            // READY|NEW|COMMITTING.
            if ( ( status & ~DIRTY ) === (READY|NEW|COMMITTING) ) {
                if ( status & DIRTY ) {
                    delete this._skToCommitted[ storeKey ];
                    delete this._skToChanged[ storeKey ];
                }
                this.setStatus( storeKey, (READY|NEW|DIRTY) );
                this._created[ storeKey ] = 1;
            } else if ( status & DESTROYED ) {
                this.setStatus( storeKey, DESTROYED );
                this.unloadRecord( storeKey );
            } else {
                NS.RunLoop.didError({
                    name: SOURCE_COMMIT_DESTROY_MISMATCH_ERROR
                });
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidNotDestroy

        Callback made by the <O.Source> object associated with this store when
        the source does not commit the destruction of some records as requested
        by a call to <O.Source#commitChanges> (usually due to a precondition
        fail, such as the server being in a different state to the client).

        If the condition is temporary (for example a precondition fail, such as
        the server being in a different state to the client) then the store
        will attempt to recommit the changes the next time commitChanges is
        called (or at the end of the current run loop if `autoCommit` is
        `true`); it is presumed that the precondition will be fixed before then.

        If the condition is permanent (as indicated by the `isPermanent`
        argument), the store will revert to the last known committed state
        (i.e. the record will be revived). If an `errors` array is passed, the
        store will first fire a `record:commit:error` event on the record
        (including in nested stores), if already instantiated. If
        <NS.Event#preventDefault> is called on the event object, the record will **not** be revived; it is up to the handler to then fix the record
        before it is recommitted.

        Parameters:
            storeKeys   - {String[]} The list of store keys of records for
                          which the destruction was not committed.
            isPermanent - {Boolean} (optional) Should the store try to commit
                          the changes again, or just revert to last known
                          committed state?
            errors      - {Object[]} (optional) An array of objects
                          representing the error in committing the store key in
                          the equivalent location in the *storeKeys* argument.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidNotDestroy: function ( storeKeys, isPermanent, errors ) {
        var l = storeKeys.length,
            _destroyed = this._destroyed,
            storeKey, status;

        while ( l-- ) {
            storeKey = storeKeys[l];
            status = this.getStatus( storeKey );
            if ( ( status & ~DIRTY ) === (READY|NEW|COMMITTING) ) {
                this.setStatus( storeKey, status & ~(COMMITTING|NEW) );
            } else if ( status & DESTROYED ) {
                this.setStatus( storeKey, ( status & ~COMMITTING )|DIRTY );
                _destroyed[ storeKey ] = 1;
                if ( isPermanent && errors &&
                        !this._notifyRecordOfError( storeKey, errors[l] ) ) {
                    this.undestroyRecord( storeKey );
                }
            } else {
                NS.RunLoop.didError({
                    name: SOURCE_COMMIT_DESTROY_MISMATCH_ERROR
                });
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return this;
    },

    _notifyRecordOfError: function ( storeKey, error ) {
        var record = this._skToRecord[ storeKey ],
            isDefaultPrevented = false,
            event;
        if ( record ) {
            event = new NS.Event( error.type || 'error', record, error );
            record.fire( 'record:commit:error', event );
            isDefaultPrevented = event.defaultPrevented;
        }
        this._nestedStores.forEach( function ( store ) {
            isDefaultPrevented =
                store._notifyRecordOfError( storeKey, error ) ||
                isDefaultPrevented;
        });
        return isDefaultPrevented;
    },

    // === Queries =============================================================

    /**
        Method: O.Store#findAll

        Returns the list of store keys with data loaded for a particular type,
        optionally filtered and/or sorted.

        Parameters:
            Type   - {O.Class} The constructor for the record type being
                     queried.
            filter - {Function} (optional) An acceptance function. This will be
                     passed the raw data object (*not* a record instance) and
                     should return true if the record should be included, or
                     false otherwise.
            sort   - {Function} (optional) A comparator function. This will be
                     passed the raw data objects (*not* record instances) for
                     two records. It should return -1 if the first record should
                     come before the second, 1 if the inverse is true, or 0 if
                     they should have the same position.

        Returns:
            {String[]} An array of store keys.
    */
    findAll: function ( Type, accept, compare ) {
        var _skToId = this._typeToSkToId[ guid( Type ) ] || {},
            _skToStatus = this._skToStatus,
            results = [],
            storeKey, filterFn, sortFn;

        for ( storeKey in _skToId ) {
            if ( _skToStatus[ storeKey ] & READY ) {
                results.push( storeKey );
            }
        }

        if ( accept ) {
            filterFn = filter.bind( this, accept );
            results = results.filter( filterFn );
            results.filterFn = filterFn;
        }

        if ( compare ) {
            sortFn = sort.bind( this, compare );
            results.sort( sortFn );
            results.sortFn = sortFn;
        }

        return results;
    },

    /**
        Method: O.Store#findOne

        Returns the store key of the first loaded record that matches an
        acceptance function.

        Parameters:
            Type   - {O.Class} The constructor for the record type to find.
            filter - {Function} (optional) An acceptance function. This will be
                     passed the raw data object (*not* a record instance) and
                     should return true if the record is the desired one, or
                     false otherwise.

        Returns:
            {(String|null)} The store key for a matching record, or null if none
            found.
    */
    findOne: function ( Type, accept ) {
        var _skToId = this._typeToSkToId[ guid( Type ) ] || {},
            _skToStatus = this._skToStatus,
            filterFn = accept && filter.bind( this, accept ),
            storeKey;

        for ( storeKey in _skToId ) {
            if ( ( _skToStatus[ storeKey ] & READY ) &&
                    ( !filterFn || filterFn( storeKey ) ) ) {
                return storeKey;
            }
        }

        return null;
    },

    /**
        Method: O.Store#addQuery

        Registers a query with the store. This is automatically called by the
        query constructor function. You should never need to call this
        manually.

        Parameters:
            query - {(O.LiveQuery|O.RemoteQuery)}
                    The query object.

        Returns:
            {O.Store} Returns self.
    */
    addQuery: function ( query ) {
        var source = this.source;
        this._idToQuery[ query.get( 'id' ) ] = query;
        if ( query instanceof NS.LiveQuery ) {
            var Type = query.get( 'Type' ),
                typeId = guid( Type );
            this.fetchAll( Type );
            ( this._liveQueries[ typeId ] ||
                ( this._liveQueries[ typeId ] = [] ) ).push( query );
        } else if ( query instanceof NS.RemoteQuery ) {
            source.fetchQuery( query );
            this._remoteQueries.push( query );
        }
        return this;
    },

    /**
        Method: O.Store#removeQuery

        Deregisters a query with the store. This is automatically called when
        you call destroy() on a query. You should never need to call this
        manually.

        Parameters:
            query - {(O.LiveQuery|O.RemoteQuery)}
                    The query object.

        Returns:
            {O.Store} Returns self.
    */
    removeQuery: function ( query ) {
        delete this._idToQuery[ query.get( 'id' ) ];
        if ( query instanceof NS.LiveQuery ) {
            var _liveQueries = this._liveQueries,
                typeId = guid( query.get( 'Type' ) ),
                typeQueries = _liveQueries[ typeId ];
            if ( typeQueries.length > 1 ) {
                typeQueries.erase( query );
            } else {
                delete _liveQueries[ typeId ];
            }
        } else if ( query instanceof NS.RemoteQuery ) {
            this._remoteQueries.erase( query );
        }
        return this;
    },

    /**
        Method: O.Store#getQuery

        Get a named query. When the same query is used in different places in
        the code, use this method to get the query rather than directly calling
        new Query(...). If the query is already created it will be returned,
        otherwise it will be created and returned. If no QueryClass is supplied
        and the id does not correspond to an existing query then `null` will be
        returned.

        Parameters:
            id         - {String} The id of the requested query.
            QueryClass - {O.Class} (optional) The query class to use if the
                         query is not already created.
            mixin    - {(Object|null)} (optional) Properties to pass to the
                         QueryClass constructor.

        Returns:
            {(O.LiveQuery|O.RemoteQuery|null)} The requested query.
    */
    getQuery: function ( id, QueryClass, mixin ) {
        var query = ( id && this._idToQuery[ id ] ) || null;
        if ( !query && QueryClass ) {
            query = new QueryClass( NS.extend( mixin || {}, {
                id: id,
                store: this,
                source: this.source
            }) );
        }
        if ( query ) {
            query.lastAccess = Date.now();
        }
        return query;
    },

    /**
        Method: O.Store#getAllRemoteQueries

        Returns a list of all remote queries registered with the store.

        Returns:
            {O.RemoteQuery[]} A list of all registered instances of
            <O.RemoteQuery>.
    */
    getAllRemoteQueries: function () {
        return this._remoteQueries;
    },

    /**
        Method (protected): O.Store#_recordDidChange

        Registers a record has changed in a way that might affect any live
        queries on that type.

        Parameters:
            storeKey - {String} The store key of the record.
    */
    _recordDidChange: function ( storeKey ) {
        var typeId = guid( this._skToType[ storeKey ] ),
            _typeToChangedSks = this._typeToChangedSks,
            changedSks = _typeToChangedSks[ typeId ] ||
                ( _typeToChangedSks[ typeId ] = {} );
        changedSks[ storeKey ] = true;
        NS.RunLoop.queueFn( 'middle', this.refreshLiveQueries, this );
    },

    /**
        Method: O.Store#refreshLiveQueries

        Refreshes the contents of all registered instances of <O.LiveQuery>
        which may have changes. This is automatically called when necessary by
        the store; you should rarely need to call this manually.

        Returns:
            {O.Store} Returns self.
    */
    refreshLiveQueries: function () {
        var _typeToChangedSks = this._typeToChangedSks,
            _liveQueries = this._liveQueries,
            typeId, typeChanges, typeQueries,
            l;

        this._typeToChangedSks = {};

        for ( typeId in _typeToChangedSks ) {
            typeChanges = Object.keys( _typeToChangedSks[ typeId ] );
            typeQueries = _liveQueries[ typeId ];
            l = typeQueries ? typeQueries.length : 0;

            while ( l-- ) {
                typeQueries[l].storeDidChangeRecords( typeChanges );
            }
            this.fire( typeId, {
                storeKeys: typeChanges
            });
        }

        return this;
    },

    liveQueriesAreReady: function ( Type ) {
        var _liveQueries = this._liveQueries[ guid( Type ) ],
            l = _liveQueries ? _liveQueries.length : 0;
        while ( l-- ) {
            _liveQueries[l].set( 'status', READY );
        }
    }
});

[ 'on', 'once', 'off' ].forEach( function ( property ) {
    Store.prototype[ property ] = function ( type, obj, method ) {
        if ( typeof type !== 'string' ) {
            type = guid( type );
        }
        return NS.EventTarget[ property ].call( this, type, obj, method );
    };
});

NS.Store = Store;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: MemoryManager.js                                                     \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Store.js                                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.MemoryManager

    A MemoryManager instance periodically checks the store to ensure it doesn't
    have beyond a certain number of records in memory. If it does, the least
    recently used records are removed until the limit has no longer been
    breached.
*/

var MemoryManager = NS.Class({

    /**
        Property (private): O.MemoryManager#_index
        Type: Number

        Keeps track of which record type we need to examine next.
    */

    /**
        Property (private): O.MemoryManager#_store
        Type: O.Store

        The store where the records are stored.
    */

    /**
        Property (private): O.MemoryManager#_restrictions
        Type: Array

        An array of objects, each containing the properties:
        - Type: The constructor for the Record or RemoteQuery subclass.
        - max: The maximum number allowed.
        - afterCleanup: An optional callback after cleanup, which will be given
          an array of removed objects of the given type, every time some are
          removed from the store.
    */

    /**
        Property: O.MemoryManager#frequency
        Type: Number
        Default: 30000 (30 seconds)

        The time in milliseconds between running the cleanup function.
    */

    /**
        Constructor: O.MemoryManager

        Parameters:
            store        - {Store} The store to be memory managed.
            restrictions - {Object} An array of objects, each containing the
                           properties:
                           * Type: The constructor for the Record or RemoteQuery
                             subclass.
                           * max: The maximum number allowed.
                           * afterCleanup: An optional callback after cleanup,
                             which will be given an array of removed objects of
                             the given type, every time some are removed from
                             the store.
            frequency    - {Number} (optional) How frequently the cleanup
                           function is called in milliseconds. Default is 30000,
                           i.e. every 30 seconds.
    */
    init: function ( store, restrictions, frequency ) {
        this._index = 0;
        this._store = store;
        this._restrictions = restrictions;

        this.isPaused = false;
        this.frequency = frequency || 30000;

        NS.RunLoop.invokeAfterDelay( this.cleanup, this.frequency, this );
    },

    /**
        Method: O.MemoryManager#cleanup

        Examines the store to see how many entries of each record type are
        present and removes references to the least recently accessed records
        until the number is under the set limit for that type. This is
        automatically called periodically by the memory manager.
    */
    cleanup: function () {
        var index = this._index,
            restrictions = this._restrictions[ index ],
            Type = restrictions.Type,
            ParentType = Type,
            max = restrictions.max,
            afterFn = restrictions.afterCleanup,
            deleted;

        if ( this.isPaused ) {
            NS.RunLoop.invokeAfterDelay( this.cleanup, this.frequency, this );
            return;
        }

        do {
            if ( ParentType === NS.Record ) {
                deleted = this.cleanupRecordType( Type, max );
                break;
            } else if ( ParentType === NS.RemoteQuery ) {
                deleted = this.cleanupQueryType( Type, max );
                break;
            }
        } while ( ParentType = ParentType.parent.constructor );

        if ( afterFn ) { afterFn( deleted ); }

        this._index = index = ( index + 1 ) % this._restrictions.length;

        // Yield between examining types so we don't hog the event queue.
        if ( index ) {
            NS.RunLoop.invokeInNextEventLoop( this.cleanup, this );
        } else {
            NS.RunLoop.invokeAfterDelay( this.cleanup, this.frequency, this );
        }
    },

    /**
        Method: O.MemoryManager#cleanupRecordType

        Parameters:
            Type - {O.Class} The record type.
            max  - {Number} The maximum number allowed.

        Removes excess records from the store.
    */
    cleanupRecordType: function ( Type, max ) {
        var store = this._store,
            _skToLastAccess = store._skToLastAccess,
            _skToData = store._skToData,
            storeKeys =
                Object.keys( store._typeToSkToId[ NS.guid( Type ) ] || {} ),
            l = storeKeys.length,
            numberToDelete = l - max,
            deleted = [],
            data, storeKey;

        storeKeys.sort( function ( a, b ) {
            return _skToLastAccess[b] - _skToLastAccess[a];
        });

        while ( numberToDelete > 0 && l-- ) {
            storeKey = storeKeys[l];
            data = _skToData[ storeKey ];
            if ( store.unloadRecord( storeKey ) ) {
                numberToDelete -= 1;
                if ( data ) { deleted.push( data ); }
            }
        }
        return deleted;
    },

    /**
        Method: O.MemoryManager#cleanupQueryType

        Parameters:
            Type - {O.Class} The query type.
            max  - {Number} The maximum number allowed.

        Removes excess remote queries from the store.
    */
    cleanupQueryType: function ( Type, max ) {
        var queries = this._store.getAllRemoteQueries()
                          .filter( function ( query ) {
                return query instanceof Type;
            }),
            l = queries.length,
            numberToDelete = l - max,
            deleted = [],
            query;

        queries.sort( function ( a, b ) {
            return b.lastAccess - a.lastAccess;
        });
        while ( numberToDelete > 0 && l-- ) {
            query = queries[l];
            if ( !query.hasObservers() ) {
                query.destroy();
                deleted.push( query );
                numberToDelete -= 1;
            }
        }
        return deleted;
    }
});

NS.MemoryManager = MemoryManager;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: NestedStore.js                                                       \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation, Store.js                                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

// Same as O.Status, inlined here for efficiency:
// Core states:
var EMPTY      =   1;
var READY      =   2;
var DESTROYED  =   4;
// Properties
var LOADING    =  16; // Request made to source to fetch record or updates.
var COMMITTING =  32; // Request been made to source to commit record.
var NEW        =  64; // Record has not been committed to source.
var DIRTY      = 128; // Record has local changes not commited to source
var OBSOLETE   = 256; // Source may have changes not yet loaded.

/**
    Class: O.NestedStore

    A Nested Store may be used to buffer changes before committing them to the
    parent store. The changes may be discarded instead of committing without
    ever affecting the parent store.
*/
var NestedStore = NS.Class({

    Extends: NS.Store,

    autoCommit: false,
    isNested: true,

    /**
        Constructor: O.NestedStore

        Parameters:
            store - {O.Store} The parent store (this may be another nested
                    store).
    */
    init: function ( store ) {
        // Own record store
        this._skToRecord = {};
        // Copy on write, shared data object store
        this._skToData = Object.create( store._skToData );
        // Copy on write, shared status store.
        this._skToStatus = Object.create( store._skToStatus );

        // Share store key -> Type
        this._skToType = store._skToType;
        // Share Type -> store key -> id
        this._typeToSkToId = store._typeToSkToId;
        // Share Type -> id -> store key
        this._typeToIdToSk = store._typeToIdToSk;

        // Own changed map
        this._skToChanged = {};
        // Own previous attributes.
        this._skToCommitted = {};
        // Not used, but needs to be present to stop error on unload
        this._skToRollback = {};

        // Share last access timestamp for
        this._skToLastAccess = store._skToLastAccess;

        this._created = {};
        this._destroyed = {};

        // Own queries
        // Map id -> query
        this._idToQuery = {};
        // Map Type -> list of local queries
        this._liveQueries = {};
        // Set of remove queries.
        this._remoteQueries = [];
        // List of types needing a refresh.
        this._queryTypesNeedRefresh = [];

        // List of nested stores
        this._nestedStores = [];

        // Type -> [ store key ] of changed records.
        this._typeToChangedSks = {};

        this._typeToStatus = store._typeToStatus;

        store.addNested( this );

        this._source = store._source;
        this._parentStore = store;
    },

    /**
        Method: O.NestedStore#destroy

        Removes the connection to the parent store so this store may be garbage
        collected.
    */
    destroy: function () {
        this._parentStore.removeNested( this );
    },

    // === Client API ==========================================================

    /**
        Method: O.Store#commitChanges

        Commits any outstanding changes (created/updated/deleted records) to the
        parent store.

        Parameters:
            callback - {Function} (optional) A callback to be made after the
                       changes have finished committing. As a nested store
                       commits to a parent store rather than a remote source,
                       the callback will be fired synchronously before this
                       method returns.

        Returns:
            {O.NestedStore} Returns self.
    */
    commitChanges: function ( callback ) {
        this.fire( 'willCommit' );
        var _created = this._created,
            _destroyed = this._destroyed,
            _skToData = this._skToData,
            _skToChanged = this._skToChanged,
            parent = this._parentStore,
            storeKey, status, data;

        for ( storeKey in _created ) {
            status = parent.getStatus( storeKey );
            data = _skToData[ storeKey ];
            if ( status === EMPTY || status === DESTROYED ) {
                parent.createRecord( storeKey, data );
            } else if ( ( status & ~(OBSOLETE|LOADING) ) ===
                    (DESTROYED|COMMITTING) ) {
                parent._skToData[ storeKey ] = data;
                parent.setStatus( storeKey, READY|NEW|COMMITTING );
            } else if ( status & DESTROYED ) {
                delete parent._destroyed[ storeKey ];
                parent._skToData[ storeKey ] = data;
                parent.setStatus( storeKey,
                    ( status & ~(DESTROYED|DIRTY) ) | READY );
            }
        }
        for ( storeKey in _skToChanged ) {
            parent.updateData( storeKey, Object.filter(
                _skToData[ storeKey ], _skToChanged[ storeKey ] ), true );
        }
        for ( storeKey in _destroyed ) {
            parent.destroyRecord( storeKey );
        }

        this._skToData = Object.create( parent._skToData );
        this._skToStatus = Object.create( parent._skToStatus );
        this._skToChanged = {};
        this._skToCommitted = {};
        this._created = {};
        this._destroyed = {};

        if ( callback ) { callback(); }

        return this.fire( 'didCommit' );
    },

    /**
        Method: O.Store#discardChanges

        Discards any outstanding changes (created/updated/deleted records),
        reverting the store to the same state as its parent.

        Returns:
            {O.NestedStore} Returns self.
    */
    discardChanges: function () {
        NestedStore.parent.discardChanges.call( this );

        var parent = this._parentStore;

        this._skToData = Object.create( parent._skToData );
        this._skToStatus = Object.create( parent._skToStatus );

        return this;
    },

    // === Low level (primarily internal) API: uses storeKey ===================

    getStatus: function ( storeKey ) {
        var status = this._skToStatus[ storeKey ] || EMPTY;
        return this._skToData.hasOwnProperty( storeKey ) ?
            status : status & ~(NEW|COMMITTING|DIRTY);
    },

    fetchAll: function ( storeKey ) {
        this._parentStore.fetchAll( storeKey );
        return this;
    },

    fetchData: function ( storeKey ) {
        this._parentStore.fetchData( storeKey );
        return this;
    },

    // === Notifications from parent store =====================================

    /**
        Method: O.NestedStore#parentDidChangeStatus

        Called by the parent store whenever it changes the status of a record.
        The nested store uses this to update its own status value for that
        record (if it has diverged from the parent) and to notify any O.Record
        instances belonging to it of the change.

        Parameters:
            storeKey - {String} The store key for the record.
            previous - {O.Status} The previous status value.
            status   - {O.Status} The new status value.
    */
    parentDidChangeStatus: function ( storeKey, previous, status ) {
        var _skToStatus = this._skToStatus;

        previous = previous & ~(NEW|COMMITTING|DIRTY);
        status = status & ~(NEW|COMMITTING|DIRTY);

        if ( _skToStatus.hasOwnProperty( storeKey ) ) {
            previous = _skToStatus[ storeKey ];
            if ( status & DESTROYED ) {
                if ( !( previous & DESTROYED ) ) {
                    // Ready dirty -> ready clean.
                    this.setData( storeKey, this._skToCommitted[ storeKey ] );
                    delete this._skToCommitted[ storeKey ];
                    delete this._skToChanged[ storeKey ];
                }
                // Ready clean/Destroyed dirty -> destroyed clean.
                delete this._skToData[ storeKey ];
                delete _skToStatus[ storeKey ];
            } else {
                _skToStatus[ storeKey ] = status =
                    previous|( status & (OBSOLETE|LOADING) );
            }
        }

        if ( previous !== status ) {
            // wasReady !== isReady
            if ( ( previous ^ status ) & READY ) {
                this._recordDidChange( storeKey );
            }
            var record = this._skToRecord[ storeKey ];
            if ( record ) {
                record.propertyDidChange( 'status', previous, status );
            }
            this._nestedStores.forEach( function ( store ) {
                store.parentDidChangeStatus( storeKey, previous, status );
            });
        }
    },

    /**
        Method: O.NestedStore#parentDidSetData

        Called by the parent store when it sets the inital data for an empty
        record. The nested store can't have any changes as a nested store cannot
        load data independently of its parent, so all we need to do is notify
        any records.

        Parameters:
            storeKey    - {String} The store key for the record.
            changedKeys - {Object} A list of keys which have changed.
    */
    parentDidSetData: function ( storeKey, changedKeys ) {
        this._notifyRecordOfChanges( storeKey, changedKeys );
        this._nestedStores.forEach( function ( store ) {
            store.parentDidSetData( storeKey, changedKeys );
        });
    },

    /**
        Method: O.NestedStore#parentDidUpdateData

        Called by the parent store whenever it makes a change to the data object
        for a record. The nested store uses this to update its own copy of the
        data object if it has diverged from that of the parent (either rebasing
        changes on top of the new parent state or discarding changes, depending
        on the value of <O.Store#rebaseConflicts>).

        Parameters:
            storeKey    - {String} The store key for the record.
            changedKeys - {Object} A list of keys which have changed.
    */
    parentDidUpdateData: function ( storeKey, changedKeys ) {
        if ( this._skToData.hasOwnProperty( storeKey ) ) {
            var _skToData = this._skToData,
                _skToChanged = this._skToChanged,
                _skToCommitted = this._skToCommitted,
                parent = this._parentStore,
                rebase = this.rebaseConflicts,
                newBase = parent.getData( storeKey ),
                oldData = _skToData[ storeKey ],
                oldChanged = _skToChanged[ storeKey ],
                newData = {},
                newChanged = {},
                clean = true,
                isChanged, key;

            changedKeys = [];

            for ( key in oldData ) {
                isChanged = !NS.isEqual( oldData[ key ], newBase[ key ] );
                if ( rebase && ( key in oldChanged ) ) {
                    if ( isChanged ) {
                        newChanged[ key ] = true;
                        clean = false;
                    }
                    newData[ key ] = oldData[ key ];
                } else {
                    if ( isChanged ) {
                        changedKeys.push( key );
                    }
                    newData[ key ] = newBase[ key ];
                }
            }
            if ( !clean ) {
                _skToChanged[ storeKey ] = newChanged;
                _skToCommitted[ storeKey ] = NS.clone( newBase );
                this.setData( storeKey, newData );
                return;
            }
            this.setStatus( storeKey,
                parent.getStatus( storeKey ) & ~(NEW|COMMITTING|DIRTY) );
            delete _skToData[ storeKey ];
            delete _skToChanged[ storeKey ];
            delete _skToCommitted[ storeKey ];
            delete this._skToStatus[ storeKey ];
        }
        this._notifyRecordOfChanges( storeKey, changedKeys );
        this._nestedStores.forEach( function ( store ) {
            store.parentDidUpdateData( storeKey, changedKeys );
        });
        this._recordDidChange( storeKey );
    },

    // === A nested store is not directly connected to a source ================

    sourceStateDidChange: null,

    sourceDidFetchRecords: null,
    sourceDidFetchPartialRecords: null,
    sourceCouldNotFindRecords: null,

    sourceDidFetchUpdates: null,
    sourceDidModifyRecords: null,
    sourceDidDestroyRecords: null,

    sourceCommitDidChangeState: null,

    sourceDidCommitCreate: null,
    sourceDidNotCreate: null,
    sourceDidCommitUpdate: null,
    sourceDidNotUpdate: null,
    sourceDidCommitDestroy: null,
    sourceDidNotDestroy: null
});

NS.NestedStore = NestedStore;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: UndoManager.js                                                       \\
// Module: DataStore                                                          \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.UndoManager
*/

var UndoManager = NS.Class({

    Extends: NS.Object,

    init: function ( mixin ) {
        this._undoStack = [];
        this._redoStack = [];

        this._isInUndoState = false;

        this.canUndo = false;
        this.canRedo = false;

        this.maxUndoCount = 1;

        UndoManager.parent.init.call( this, mixin );
    },

    _pushState: function ( stack, data ) {
        stack.push( data );
        while ( stack.length > this.maxUndoCount ) {
            stack.shift();
        }
        this._isInUndoState = true;
    },

    dataDidChange: function () {
        this._isInUndoState = false;
        this._redoStack.length = 0;
        return this
            .set( 'canRedo', false )
            .set( 'canUndo', true )
            .fire( 'input' );
    },

    saveUndoCheckpoint: function () {
        if ( !this._isInUndoState ) {
            var data = this.getUndoData();
            if ( data !== null ) {
                this._pushState( this._undoStack, data );
            } else {
                this._isInUndoState = true;
                this.set( 'canUndo', !!this._undoStack.length );
            }
        }
        return this;
    },

    undo: function () {
        if ( this.get( 'canUndo' ) ) {
            if ( !this._isInUndoState ) {
                this.saveUndoCheckpoint();
                this.undo();
            } else {
                var redoData = this.applyChange( this._undoStack.pop(), false );
                if ( redoData ) {
                    this._pushState( this._redoStack, redoData );
                }
                this.set( 'canUndo', !!this._undoStack.length )
                    .set( 'canRedo', !!redoData )
                    .fire( 'undo' );
            }
        }
        return this;
    },

    redo: function () {
        if ( this.get( 'canRedo' ) ) {
            this._pushState( this._undoStack,
                this.applyChange( this._redoStack.pop(), true )
            );
            this.set( 'canUndo', true )
                .set( 'canRedo', !!this._redoStack.length )
                .fire( 'redo' );
        }
        return this;
    },

    getUndoData: function () {},

    applyChange: function (/* data, isRedo */) {}
});

var StoreUndoManager = NS.Class({

    Extends: UndoManager,

    init: function ( mixin ) {
        StoreUndoManager.parent.init.call( this, mixin );
        this.get( 'store' )
            .on( 'willCommit', this, 'saveUndoCheckpoint' )
            .on( 'record:user:create', this, 'dataDidChange' )
            .on( 'record:user:update', this, 'dataDidChange' )
            .on( 'record:user:destroy', this, 'dataDidChange' );
    },

    destroy: function () {
        this.get( 'store' )
            .off( 'willCommit', this, 'saveUndoCheckpoint' )
            .off( 'record:user:create', this, 'dataDidChange' )
            .off( 'record:user:update', this, 'dataDidChange' )
            .off( 'record:user:destroy', this, 'dataDidChange' );
        StoreUndoManager.parent.destroy.call( this );
    },

    getUndoData: function () {
        var store = this.get( 'store' );
        return store.hasChanges() ? store.getInverseChanges() : null;
    },

    applyChange: function ( data ) {
        var store = this.get( 'store' ),
            inverse;
        store.applyChanges( data );
        inverse = store.getInverseChanges();
        store.commitChanges();
        return inverse;
    },

    undo: function () {
        if ( this._isInUndoState || !this.get( 'store' ).hasChanges() ) {
            StoreUndoManager.parent.undo.call( this );
        }
        return this;
    }
});

NS.UndoManager = UndoManager;
NS.StoreUndoManager = StoreUndoManager;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: View.js                                                              \\
// Module: View                                                               \\
// Requires: Core, Foundation, DOM, UA                                        \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var UID = 0;

var POSITION_SAME = 0x00,
    POSITION_DISCONNECTED = 0x01,
    POSITION_PRECEDING = 0x02,
    POSITION_FOLLOWING = 0x04,
    POSITION_CONTAINS = 0x08,
    POSITION_CONTAINED_BY = 0x10;

var userSelectNone =
        ( NS.UA.cssProps[ 'user-select' ] === '-moz-user-select' ) ?
            '-moz-none' : 'none';

/**
    Class: O.View

    Extends: O.Object

    The O.View class is the basis for any graphical part of an application.

    ### Using the View system ###

    The View class is likely to be the most commonly subclassed class in your
    application. In the same way that an HTML document consists of a tree of
    element nodes, the UI for an application built with the O library will
    consist of a tree of O.View instances. In idiomatic O, it is common to
    include the behaviour of the view as well as the render method (equivalent
    to the template in other systems) in the class definition.

    Following another idiomatic pattern of the O libary, the standard
    constructor for O.View takes a single argument which is used to extend and
    override existing methods and properties on the instance; essentially
    creating an instance of an anonymous subclass. For one-off views, this is
    often the easiest thing to do. For example:

        new O.View({
            isImportant: false,
            className: function () {
                return 'v-Message' +
                    ( this.get( 'isImportant' ) ? ' is-important' : '' );
            }.property( 'isImportant' ),
            draw: function ( layer, Element, el ) {
                return [
                    el( 'h1#title', {
                        text: O.bind( this, 'title' )
                    }),
                    el( 'p.u-normal', {
                        html: O.bind( this, 'content' )
                    }),
                    el( 'footer', [
                        'For more information, please go to',
                        el( 'a', { href: 'http://www.overturejs.com/' }, [
                            overturejs.com'
                        ])
                    ])
                ];
            }
        });

    If the view type is going to be reused, you should create a subclass
    instead; this is more efficient.

    ### The rendering pipeline ###

    A view is automatically rendered just before being inserted into the
    document; it is rare you will need to call <O.View#render> from custom code,
    unless writing views with custom insertion methods. The role of the render
    method is to ensure that the underlying DOM representation of the view has
    been created; by default it creates the layer (the root DOM node for the
    view), and passes it to the <O.View#draw> method. This is the one you will
    normally override to draw your own view. You must ensure that as part of
    this, all child views are also rendered; the default version of the method
    is simply to call render() on each of the child views and append them to the
    layer.

    There are two properties on every view instance representing its current
    render state. The `isRendered` property indicates whether render() has yet
    been called. The `isInDocument` property indicates whether the layer has
    been inserted into the document (so is part of the live/visible DOM).
    Methods on the view instance are called before and after adding or removing
    the layer to the document; it is occassionally required to run some code at
    one of these stages, for example the scroll position on a DOM element is
    lost when it is removed from the document, and needs to be restored
    immediately after the element is reappended to the document. If you do
    override one of these properties, be sure to call the parent method inside
    your code.

    A View corresponds to a single DOM node; you will often then draw to this,
    both directly and by inserting sub-views. You are free to implement the
    <#draw> method which does this in any way you like, however it is
    recommended to make use of <O.Element.create> to write your template in
    JavaScript, as in the example above. This makes it easy to use bindings and
    insert other subviews directly.

    ### Updating for changes ###

    A view is often used to represent a piece of mutable data. In this case, you
    want to keep the view in sync with the underlying data. This is easy to do
    using standard bindings; you can bind any property of the DOM. You can also
    include sub views just like normal DOM children. For form controls, which
    need to synchronise in two directions, use the wrapper views, like
    O.CheckboxView etc. For example:

        new O.View({
            draw: function ( layer, Element, el ) {
                var content = this.get( 'content' );
                return [
                    el( 'h1#title', {
                        className: O.bind( content, 'isDone',
                        function ( isDone ) {
                            return isDone ? 'done' : 'todo';
                        }),
                        text: O.bind( content, 'title' )
                    }),
                    el( 'p', [
                        new CheckboxView({
                            value: O.bind( content, 'isDone' ),
                            label: O.bind( content, 'description' )
                        })
                    ])
                ];
            }
        });

    The other approach is to observe events and manually update the DOM.

    ### Events ###

    All events are handled very efficiently by delegation. You can register
    methods that should be invoked on certain events by calling the
    <Function#on> method. For example:

        new O.View({
            alert: function ( event ) {
                window.alert( 'You clicked the view!' );
            }.on( 'click' )
        });

    The arguments to the 'on' method specify the events that should trigger the
    method. The event object is passed as the sole parameter to the method when
    this happens. It is perfectly fine for more than one method on the object to
    handle the same event, although note in this case there is no guarentee on
    the order they will be triggered. Unless event.stopPropagation() is called,
    the event will propagate to the object specified as the nextEventTarget
    property on the object, by default the parent view.

    ### Layout ###

    The 'id' and 'className' property of the view correspond to the 'id' and
    'class' property on the underlying DOM node. The id must not change after
    the view has been rendered. The className property may be changed as
    frequently as you like; the underlying DOM node will be kept in sync. It is
    common to make className a computed property that updates depending on the
    state of the view.
*/

var renderView = function ( view ) {
    return view.render().get( 'layer' );
};

var View = NS.Class({

    Extends: NS.Object,

    /**
        Property: O.View#parentView
        Type: O.View|null

        The parent view of this view.
    */

    /**
        Property: O.View#childViews
        Type: O.View[]

        An array of the child views of this view.
    */

    /**
        Property: O.View#syncOnlyInDocument
        Type: Boolean
        Default: true

        If true, all bindings to the view will be suspended when the view is not
        in the document, and resumed/resynced just before being inserted into
        the document for efficiency.
    */
    syncOnlyInDocument: true,

    init: function ( mixin ) {
        this._needsRedraw = null;

        this.id = 'v' + UID++;
        this.parentView = null;
        this.isRendered = false;
        this.isInDocument = false;

        View.parent.init.call( this, mixin );

        var children = this.get( 'childViews' ) || ( this.childViews = [] ),
            l = children.length;
        while ( l-- ) {
            children[l].set( 'parentView', this );
        }
        if ( this.get( 'syncOnlyInDocument' ) ) {
            this.suspendBindings();
        }
    },

    destroy: function () {
        if ( this.get( 'isInDocument' ) ) {
            throw new Error( 'Cannot destroy a view in the document' );
        }

        var children = this.get( 'childViews' ),
            l = children.length;
        while ( l-- ) {
            children[l].destroy();
        }
        if ( this.get( 'isRendered' ) ) {
            this.willDestroyLayer( this.get( 'layer' ) );
        }
        this.clearPropertyCache();
        View.parent.destroy.call( this );
    },

    // --- Layer ---

    /**
        Property: O.View#isRendered
        Type: Boolean

        Has the <O.View#render> method been called yet?
    */

    /**
        Property: O.View#isInDocument
        Type: Boolean

        Is the view currently part of the document DOM tree hierarchy?
    */

    /**
        Property: O.View#id
        Type: String

        The id of the view. Automatically assigned if not overridden. Will be
        set as the id of the underlying DOM node.
    */

    /**
        Property: O.View#className
        Type: String|undefined
        Default: undefined

        If defined, this is set as the class attribute on the underlying DOM
        node. Any change to this property will be propagated to the DOM node.
    */
    className: undefined,

    /**
        Property: O.View#layerTag
        Type: String
        Default: 'div'

        The node type to use for the layer representing this view.
    */
    layerTag: 'div',

    /**
        Property: O.View#layer
        Type: Element

        The underlying DOM node for this layer.
    */
    layer: function () {
        var layer = NS.Element.create( this.get( 'layerTag' ), {
            id: this.get( 'id' ),
            className: this.get( 'className' ),
            style: Object.toCSSString( this.get( 'layerStyles' ) ),
            unselectable: this.get( 'allowTextSelection' ) ? undefined : 'on'
        });
        this.didCreateLayer( layer );
        return layer;
    }.property(),

    /**
        Method: O.View#didCreateLayer

        Called immediately after the layer is created. By default does nothing.

        Parameters:
            layer - {Element} The DOM node.
    */
    didCreateLayer: function (/* layer */) {},

    /**
        Method: O.View#willDestroyLayer

        Called immediately before the layer is destroyed.

        Parameters:
            layer - {Element} The DOM node.
    */
    willDestroyLayer: function (/* layer */) {
        this.set( 'isRendered', false );
    },

    /**
        Method: O.View#willEnterDocument

        Called immediately before the layer is appended to the document.

        Returns:
            {O.View} Returns self.
    */
    willEnterDocument: function () {
        if ( this.get( 'syncOnlyInDocument' ) ) {
            this.resumeBindings();
        }

        if ( this._needsRedraw ) {
            this.redraw();
        }

        // Must iterate forward and not cache childViews or length.
        // Switch views may append extra child views when they are rendered.
        var childViews = this.get( 'childViews' ),
            i;
        for ( i = 0; i < childViews.length; i += 1 ) {
            childViews[i].willEnterDocument();
        }

        return this;
    },

    /**
        Method: O.View#didEnterDocument

        Called immediately after the layer is appended to the document.

        Returns:
            {O.View} Returns self.
    */
    didEnterDocument: function () {
        // If change was made since willEnterDocument, will not be
        // flushed, so add redraw to render queue.
        if ( this._needsRedraw ) {
            NS.RunLoop.queueFn( 'render', this.redraw, this );
        }
        this.set( 'isInDocument', true );

        NS.ViewEventsController.registerActiveView( this );

        this.computedPropertyDidChange( 'pxLayout' );

        var childViews = this.get( 'childViews' ),
            i;
        for ( i = 0; i < childViews.length; i += 1 ) {
            childViews[i].didEnterDocument();
        }

        return this;
    },

    /**
        Method: O.View#willLeaveDocument

        Called immediately before the layer is removed from the document.

        Returns:
            {O.View} Returns self.
    */
    willLeaveDocument: function () {
        this.set( 'isInDocument', false );

        NS.ViewEventsController.deregisterActiveView( this );

        var children = this.get( 'childViews' ),
            l = children.length;
        while ( l-- ) {
            children[l].willLeaveDocument();
        }

        return this;
    },

    /**
        Method: O.View#didLeaveDocument

        Called immediately after the layer is removed from the document.

        Returns:
            {O.View} Returns self.
    */
    didLeaveDocument: function () {
        var children = this.get( 'childViews' ),
            l = children.length;
        while ( l-- ) {
            children[l].didLeaveDocument();
        }
        if ( this.get( 'syncOnlyInDocument' ) ) {
            this.suspendBindings();
        }
        return this;
    },

    // --- Event triage ---

    /**
        Property: O.View#nextEventTarget
        Type: O.EventTarget|null

        The next object to bubble events to. Unless overriden, this will be the
        parent view of this view.
    */
    nextEventTarget: function () {
        return this.get( 'parentView' );
    }.property( 'parentView' ),

    /**
        Method: O.View#handleEvent

        Handler for native DOM events where this view class is registered as the
        handler. If you need to observe a DOM event which for performance
        reasons is not normally observed by the root view, for example
        mousemove, you should register the view object *directly* as the
        handler, e.g.

            layer.addEventListener( 'mouseover', this, false );

        The handleEvent method will then cause the event to be fired in the
        normal fashion on the object.

        Parameters:
            event - {Event} The DOM event object.
    */
    handleEvent: function ( event ) {
        NS.ViewEventsController.handleEvent( event );
    },

    // --- Behaviour ---

    /**
        Property: O.View#isDraggable
        Type: Boolean
        Default: false

        Is this a draggable view? Note, to make the view draggable, you should
        include <O.Draggable> in your subclass rather than just setting this to
        true.
    */
    isDraggable: false,

    /**
        Property: O.View#allowTextSelection
        Type: Boolean
        Default: false

        May text be selected by the user inside this view? Can be overridden
        inside subviews.
   */
    allowTextSelection: false,

    _cancelTextSelection: function ( event ) {
        if ( !this.get( 'allowTextSelection' ) ) {
            event.preventDefault();
        }
        event.stopPropagation();
    }.on( 'selectstart' ),

    // --- Layout ---

    /**
        Property: O.View#positioning
        Type: String
        Default: 'relative'

        What type of positioning to use to layout the DOM node of this view.
        Will normally be either 'relative' (the default) or 'absolute'.
   */
    positioning: 'relative',

    /**
        Property: O.View#layout
        Type: Object
        Default: {}

        The CSS properties to apply to the view's layer. Any number values are
        presumed to be in 'px', any string values are presumed to have an
        appropriate unit suffix.
    */
    layout: {},

    /**
        Property: O.View#layerStyles
        Type: Object

        An object representing all of the CSS styles set on the view DOM node,
        as calculated from various other properties on the view. These are
        recalculated, and the DOM node is updated, if any of the dependent
        properties change.
    */
    layerStyles: function () {
        var allowTextSelection = this.get( 'allowTextSelection' );
        return NS.extend({
            position: this.get( 'positioning' ),
            cursor: allowTextSelection ? 'auto' : undefined,
            userSelect: allowTextSelection ? 'text' : userSelectNone
        }, this.get( 'layout' ) );
    }.property( 'layout', 'allowTextSelection', 'positioning' ),

    /**
        Method: O.View#render

        Ensure the view is rendered. Has no effect if the view is already
        rendered.

        Returns:
            {O.View} Returns self.
    */
    render: function () {
        if ( !this.get( 'isRendered' ) ) {
            // render() called just before inserting in doc, so should
            // resume bindings early to ensure initial render is correct.
            if ( this.get( 'syncOnlyInDocument' ) ) {
                this.resumeBindings();
            }
            this.set( 'isRendered', true );
            var Element = NS.Element,
                prevView = Element.forView( this ),
                layer = this.get( 'layer' ),
                children = this.draw( layer, Element, Element.create );
            if ( children ) {
                Element.appendChildren( layer, children );
            }
            Element.forView( prevView );
        }
        return this;
    },

    /**
        Method (protected): O.View#draw

        Draw the initial state of the view. You should override this method to
        draw your views. By default, it simply calls <O.View#render> on all
        child views and appends them to the view's DOM node.

        Parameters:
            layer   - {Element} The root DOM node of the view.
            Element - {Object} A reference to the O.Element object.
            el      - {Function} A reference to the O.Element.create function.
    */
    draw: function (/* layer, Element, el */) {
        return this.get( 'childViews' ).map( renderView );
    },

    /**
        Property (private): O.View#_needsRedraw
        Type: Array|null

        Array of tuples for properties that need a redraw. Each tuple has the
        property name as the first item and the old value as the second.
    */

    /**
        Method: O.View#propertyNeedsRedraw

        Adds a property to the needsRedraw queue and if in document, schedules
        the O.View#redraw method to be run in the next 'render' phase of the run
        loop. This method is automatically called when the className or
        layerStyles properties change. If the view needs to be redrawn when
        other properties change too, override this method and add the other
        properties as observees as well.

        Parameters:
            _             - {*} Unused
            layerProperty - {String} The name of the property needing a redraw
            oldProp       - {*} The previous value of the property
    */
    propertyNeedsRedraw: function ( _, layerProperty, oldProp ) {
        if ( this.get( 'isRendered' ) ) {
            var needsRedraw = this._needsRedraw || ( this._needsRedraw = [] ),
                i, l;
            for ( i = 0, l = needsRedraw.length; i < l; i += 1 ) {
                if ( needsRedraw[i][0] === layerProperty ) {
                    return this;
                }
            }
            needsRedraw[l] = [
                layerProperty,
                oldProp
            ];
            if ( this.get( 'isInDocument' ) ) {
                NS.RunLoop.queueFn( 'render', this.redraw, this );
            }
        }
        return this;
    }.observes( 'className', 'layerStyles' ),

    /**
        Method: O.View#redraw

        Updates the rendering of the view to account for any changes in the
        state of the view. By default, just calls
        `this.redraw<Property>( layer, oldValue )` for each property that has
        been passed to <O.View#propertyNeedsRedraw>.

        Returns:
            {O.View} Returns self.
    */
    redraw: function () {
        var needsRedraw = this._needsRedraw,
            layer, i, l, prop;
        if ( needsRedraw && !this.isDestroyed && this.get( 'isRendered' ) ) {
            layer = this.get( 'layer' );
            this._needsRedraw = null;
            for ( i = 0, l = needsRedraw.length; i < l; i += 1 ) {
                prop = needsRedraw[i];
                this[ 'redraw' + prop[0].capitalise() ]( layer, prop[1] );
            }
        }
        return this;
    },

    /**
        Method: O.View#redrawLayer

        Redraws the entire layer by removing all existing children and then
        calling <O.View#draw> again. Warning: it is only safe to use this
        implementation if the view has no child views and no bindings to any of
        its DOM elements.

        Parameters:
            layer - {Element} The view's layer.
    */
    redrawLayer: function ( layer ) {
        var Element = NS.Element,
            prevView = Element.forView( this ),
            childViews = this.get( 'childViews' ),
            l = childViews.length,
            node, view;

        while ( l-- ) {
            view = childViews[l];
            this.removeView( view );
            view.destroy();
        }
        while ( node = layer.lastChild ) {
            layer.removeChild( node );
        }
        Element.appendChildren( layer,
            this.draw( layer, Element, Element.create )
        );
        Element.forView( prevView );
    },

    /**
        Method: O.View#redrawClassName

        Sets the className on the layer to match the className property of the
        view. Called automatically when the className property changes.

        Parameters:
            layer - {Element} The view's layer.
    */
    redrawClassName: function ( layer ) {
        layer.className = this.get( 'className' );
    },

    /**
        Method: O.View#redrawLayerStyles

        Sets the style attribute on the layer to match the layerStyles property
        of the view. Called automatically when the layerStyles property changes.

        Parameters:
            layer - {Element} The view's layer.
    */
    redrawLayerStyles: function ( layer ) {
        layer.style.cssText = Object.toCSSString( this.get( 'layerStyles' ) );
        this.didResize();
    },

    // --- Dimensions ---

    /**
        Method: O.View#parentViewDidResize

        Called automatically whenever the parent view resizes. Rather than
        override this method, you should normally observe the <O.View#pxLayout>
        property if you're interested in changes to the view size.
    */
    parentViewDidResize: function () {
        // px dimensions only have a defined value when part of the document,
        // so if we're not visible, let's just ignore the change.
        if ( this.get( 'isInDocument' ) ) {
            this.didResize();
        }
    },

    /**
        Method: O.View#didResize

        Called when the view may have resized. This will invalidate the pxLayout
        properties and inform child views.
    */
    didResize: function () {
        this.computedPropertyDidChange( 'pxLayout' );
        var children = this.get( 'childViews' ),
            l = children.length;
        while ( l-- ) {
            children[l].parentViewDidResize();
        }
    },

    /**
        Property: O.View#scrollTop
        Type: Number

        The vertical scroll position in pixels.
    */
    scrollTop: 0,

    /**
        Property: O.View#scrollLeft
        Type: Number

        The horizontal scroll position in pixels.
    */
    scrollLeft: 0,

    /**
        Property: O.View#pxLayout
        Type: Object

        An object specifying the layout of the view in pixels. Properties:
        - top: The y-axis offset in pixels of the top edge of the view from the
          top edge of its parent's view.
        - left: The x-axis offset in pixels of the left edge of the view from
          the left edge of its parent's view.
        - width: The width of the view in pixels.
        - height: The height of the view in pixels.
    */
    pxLayout: function () {
        return  {
            top: this.get( 'pxTop' ),
            left: this.get( 'pxLeft' ),
            width: this.get( 'pxWidth' ),
            height: this.get( 'pxHeight' )
        };
    }.property(),

    /**
        Property: O.View#pxTop
        Type: Number

        The position in pixels of the top edge of the layer from the top edge of
        the parent view's layer.
    */
    pxTop: function () {
        if ( !this.get( 'isInDocument' ) ) {
            return 0;
        }
        var parent = this.get( 'parentView' ).get( 'layer' ),
            parentOffsetParent = parent.offsetParent,
            layer = this.get( 'layer' ),
            offset = 0;
        do {
            if ( layer === parentOffsetParent ) {
                offset -= parent.offsetTop;
                break;
            }
            offset += layer.offsetTop;
        } while ( layer && ( layer = layer.offsetParent ) !== parent );
        return offset;
    }.property( 'pxLayout' ),

    /**
        Property: O.View#pxLeft
        Type: Number

        The position in pixels of the left edge of the layer from the left edge
        of the parent view's layer.
    */
    pxLeft: function () {
        if ( !this.get( 'isInDocument' ) ) {
            return 0;
        }
        var parent = this.get( 'parentView' ).get( 'layer' ),
            parentOffsetParent = parent.offsetParent,
            layer = this.get( 'layer' ),
            offset = 0;
        do {
            if ( layer === parentOffsetParent ) {
                offset -= parent.offsetLeft;
                break;
            }
            offset += layer.offsetLeft;
        } while ( layer && ( layer = layer.offsetParent ) !== parent );
        return offset;
    }.property( 'pxLayout' ),

    /**
        Property: O.View#pxWidth
        Type: Number

        The width of the view's layer in pixels.
    */
    pxWidth: function () {
        return this.get( 'isInDocument' ) ?
            this.get( 'layer' ).offsetWidth : 0;
    }.property( 'pxLayout' ),

    /**
        Property: O.View#pxHeight
        Type: Number

        The height of the view's layer in pixels.
    */
    pxHeight: function () {
        return this.get( 'isInDocument' ) ?
            this.get( 'layer' ).offsetHeight : 0;
    }.property( 'pxLayout' ),

    /**
        Property: O.View#visibleRect
        Type: Object

        Using a pixel coordinate system with (0,0) at the top left corner of
        this view's layer, returns the rectangle (x, y, width, height) of this
        layer which is currently visible on screen.

        For performance reasons, the default implementation does not accurately
        take into account clipping by parent view; you should must include
        <O.TrueVisibleRect> in the view if you need this to be accurate.
    */
    visibleRect: function () {
        return {
            x: this.get( 'scrollLeft' ),
            y: this.get( 'scrollTop' ),
            width: this.get( 'pxWidth' ),
            height: this.get( 'pxHeight' )
        };
    }.property( 'scrollLeft', 'scrollTop', 'pxLayout' ),

    /**
        Method: O.View#getPositionRelativeTo

        Get the offset of this view relative to another view. Both views should
        be currently in the document.

        Parameters:
            view - {O.View} The view to get the offset from.

        Returns:
            {Object} An object with 'top' and 'left' properties, each being the
            number of pixels this view is offset from the given view.
    */
    getPositionRelativeTo: function ( view ) {
        // If it's a scroll view, it may not have synced the current scroll
        // positions yet. Force this.
        if ( view.syncBackScroll ) {
            view.syncBackScroll();
        }
        var getPosition = NS.Element.getPosition,
            selfPosition = getPosition( this.get( 'layer' ) ),
            viewPosition = getPosition( view.get( 'layer' ) );
        selfPosition.top -= viewPosition.top - view.get( 'scrollTop' );
        selfPosition.left -= viewPosition.left - view.get( 'scrollLeft' );
        return selfPosition;
    },

    // --- Insertion and deletion ---

    /**
        Method: O.View#insertView

        Insert a new child view. If the view already has a parent view, it will
        be removed from that view first.

        Parameters:
            view       - {O.View} The new child view to insert.
            relativeTo - {(Element|O.View)} (optional) The DOM node or child
                         view to insert the new child view's layer relative to.
                         If not supplied, or null/undefined, the child will be
                         inserted relative to this view's layer.
            where      - {String} (optional) Specifies where the view's layer
                         should be placed in the DOM tree relative to the
                         relativeView node. Defaults to 'bottom' (appended to
                         node), may also be 'before', 'after' or 'top'.

        Returns:
            {O.View} Returns self.
    */
    insertView: function ( view, relativeTo, where ) {
        var oldParent = view.get( 'parentView' ),
            childViews = this.get( 'childViews' ),
            index, isInDocument, layer, parent, before;

        if ( oldParent === this ) {
            return this;
        }

        if ( !relativeTo && ( where === 'before' || where === 'after' ) ) {
            this.get( 'parentView' ).insertView( view, this, where );
            return this;
        }

        if ( oldParent ) {
            oldParent.removeView( view );
        }
        view.set( 'parentView', this );

        if ( relativeTo instanceof View ) {
            index = childViews.indexOf( relativeTo );
            index = ( index > -1 ) ?
                where === 'before' ?
                    index :
                    index + 1 :
                childViews.length;
            childViews.splice( index, 0, view );
            relativeTo = relativeTo.get( 'layer' );
        } else {
            if ( where === 'top' ) {
                childViews.unshift( view );
            } else {
                childViews.push( view );
            }
        }

        if ( this.get( 'isRendered' ) ) {
            if ( !relativeTo ) {
                relativeTo = this.get( 'layer' );
                if ( where === 'before' || where === 'after' ) {
                    where = '';
                }
            }
            isInDocument = this.get( 'isInDocument' );
            parent = ( where === 'before' || where === 'after' ) ?
                relativeTo.parentNode : relativeTo;
            before = ( where === 'before' ) ? relativeTo :
                ( where === 'top' ) ? relativeTo.firstChild :
                ( where === 'after' ) ? relativeTo.nextSibling : null;
            layer = view.render().get( 'layer' );
            if ( isInDocument ) {
                view.willEnterDocument();
            }
            if ( before ) {
                parent.insertBefore( layer, before );
            } else {
                parent.appendChild( layer );
            }
            if ( isInDocument ) {
                view.didEnterDocument();
            }
        }
        this.propertyDidChange( 'childViews' );
        return this;
    },

    /**
        Method: O.View#replaceView

        Replaces one child view with another. If the new view already has a
        parent view, it will be removed from that view first. The new view will
        be inserted in the exact same position in the DOM as the view it is
        replacing. If the oldView supplied is not actually an existing child of
        this view, this method has no effect.

        Parameters:
            view    - {O.View} The new child view to insert.
            oldView - {O.View} The old child view to replace.

        Returns:
            {O.View} Returns self.
    */
    replaceView: function ( view, oldView ) {
        if ( view === oldView ) { return this; }
        var children = this.get( 'childViews' ),
            i = children.indexOf( oldView ),
            oldParent = view.get( 'parentView' );
        if ( i === -1 ) { return this; }

        if ( oldParent ) { oldParent.removeView( view ); }
        view.set( 'parentView', this );
        children.setObjectAt( i, view );

        if ( this.get( 'isRendered' ) ) {
            var isInDocument = this.get( 'isInDocument' ),
                oldLayer = oldView.get( 'layer' );
            view.render();
            if ( isInDocument ) {
                oldView.willLeaveDocument();
                view.willEnterDocument();
            }
            oldLayer.parentNode.replaceChild( view.get( 'layer' ), oldLayer );
            if ( isInDocument ) {
                view.didEnterDocument();
                oldView.didLeaveDocument();
            }
        }

        oldView.set( 'parentView', null );
        this.propertyDidChange( 'childViews' );
        return this;
    },

    /**
        Method: O.View#removeView

        Removes a child view from this view. Has no effect if the view passed as
        an argument is not a child view of this view.

        Parameters:
            view - {O.View} The child view to remove.

        Returns:
            {O.View} Returns self.
    */
    removeView: function ( view ) {
        var children = this.get( 'childViews' ),
            i = children.lastIndexOf( view ),
            isInDocument, layer;

        if ( i === -1 ) {
            return this;
        }

        if ( this.get( 'isRendered' ) ) {
            isInDocument = this.get( 'isInDocument' );
            layer = view.get( 'layer' );
            if ( isInDocument ) {
                view.willLeaveDocument();
            }
            layer.parentNode.removeChild( layer );
            if ( isInDocument ) {
                view.didLeaveDocument();
            }
        }
        children.splice( i, 1 );
        view.set( 'parentView', null );
        this.propertyDidChange( 'childViews' );
        return this;
    },

    detach: function () {
        var parentView = this.get( 'parentView' );
        if ( parentView ) {
            parentView.removeView( this );
        }
        return this;
    },

    // --- Tree position and searching ---

    /**
        Method: O.View#compareViewTreePosition

        Returns a constant giving the relative position in the view tree (as
        specified by the parentView/childViews parameters) of this view compared
        to the view given as a parameter. The constants are:

            O.View.POSITION_SAME         - They are the same view instance.
            O.View.POSITION_DISCONNECTED - This view is not in the same tree as
                                           the given view.
            O.View.POSITION_PRECEDING    - This view is before the given view in
                                           the DOM tree
            O.View.POSITION_FOLLOWING    - This view is after the given view in
                                           the DOM tree
            O.View.POSITION_CONTAINS     - This view contains the given view.
            O.View.POSITION_CONTAINED_BY - This view is contained by the given
                                           view.

        Parameters:
            view - {O.View} The view to compare position to.

        Returns:
            {Number} Relative position.
    */
    compareViewTreePosition: function ( b ) {
        if ( this === b ) {
            return POSITION_SAME;
        }

        var a = this,
            aParents = [a],
            bParents = [b],
            parent = a,
            al, bl, children, l, view;

        while ( parent = parent.get( 'parentView' ) ) {
            if ( parent === b ) {
                return POSITION_CONTAINED_BY;
            }
            aParents.push( parent );
        }
        parent = b;
        while ( parent = parent.get( 'parentView' ) ) {
            if ( parent === a ) {
                return POSITION_CONTAINS;
            }
            bParents.push( parent );
        }

        al = aParents.length;
        bl = bParents.length;
        while ( al-- && bl-- ) {
            if ( ( a = aParents[ al ] ) !== ( b = bParents[ bl ] ) ) {
                parent = aParents[ al + 1 ];
                if ( !parent ) {
                    return POSITION_DISCONNECTED;
                } else {
                    children = parent.get( 'childViews' );
                    l = children.length;
                    while ( l-- ) {
                        view = children[l];
                        if ( view === b ) {
                            return POSITION_PRECEDING;
                        }
                        if ( view === a ) {
                            return POSITION_FOLLOWING;
                        }
                    }
                    break;
                }
            }
        }

        return POSITION_DISCONNECTED;
    },

    /**
        Method: O.View#getParent

        Finds the nearest ancestor in the view hierarchy which is an instance of
        a particular view class.

        Parameters:
            Type - {O.Class} A view type (i.e. a subclass of O.View).

        Returns:
            {(O.View|null)} Returns the nearest parent view of the given type or
            null if none of the view's ancestors are of the required type.
    */
    getParent: function ( Type ) {
        var parent = this;
        do {
            parent = parent.get( 'parentView' );
        } while ( parent && !( parent instanceof Type ) );
        return parent || null;
    }
});

// Expose Globals:

View.LAYOUT_FILL_PARENT = {
    top: 0,
    left: 0,
    bottom: 0,
    right: 0
};

View.POSITION_SAME = POSITION_SAME;
View.POSITION_DISCONNECTED = POSITION_DISCONNECTED;
View.POSITION_PRECEDING = POSITION_PRECEDING;
View.POSITION_FOLLOWING = POSITION_FOLLOWING;
View.POSITION_CONTAINS = POSITION_CONTAINS;
View.POSITION_CONTAINED_BY = POSITION_CONTAINED_BY;

View.peekId = function () {
    return 'v' + UID;
};

NS.View = View;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RootView.js                                                          \\
// Module: View                                                               \\
// Requires: View.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/*global window */

/**
    Class: O.RootView

    Extends: O.View

    An O.RootView instance uses an existing DOM node for its layer, and forms
    the root of the O.View tree making up your application. The root view adds
    DOM event listeners to its layer to observe and dispatch events for the
    whole view hierarchy.

        MyApp.views.mainWindow = new O.RootView( document );

    Normally, you will create an O.RootView instance with the document node for
    each window in your application, but if your application is not taking over
    the full page, it can be initiated with any other node already in the
    document.
*/
var RootView = NS.Class({

    Extends: NS.View,

    syncOnlyInDocument: false,

    layer: null,

    init: function ( node, mixin ) {
        RootView.parent.init.call( this, mixin );

        // Node.DOCUMENT_NODE => 9.
        var nodeIsDocument = ( node.nodeType === 9 ),
            doc = nodeIsDocument ? node : node.ownerDocument,
            win = doc.defaultView,
            events, l;

        events = [
            'click', 'mousedown', 'mouseup', 'dblclick',
            'keypress', 'keydown', 'keyup',
            'dragstart', 'selectstart',
            'touchstart', 'touchmove', 'touchend', 'touchcancel',
            'cut'
        ];
        for ( l = events.length; l--; ) {
            node.addEventListener( events[l], this, false );
        }
        // These events don't bubble: have to capture.
        // In IE, we use a version of focus and blur which will bubble, but
        // there's no way of bubbling/capturing change and input.
        // These events are automatically added to all inputs when created
        // instead.
        events = [ 'focus', 'blur', 'change', 'input' ];
        for ( l = events.length; l--; ) {
            node.addEventListener( events[l], this, true );
        }
        events = [ 'resize', 'orientationchange', 'scroll' ];
        for ( l = events.length; l--; ) {
            win.addEventListener( events[l], this, false );
        }

        this.isRendered = true;
        this.isInDocument = true;
        this.layer = nodeIsDocument ? node.body : node;
    },

    _onScroll: function ( event ) {
        var layer = this.get( 'layer' ),
            isBody = ( layer.nodeName === 'BODY' ),
            doc = layer.ownerDocument,
            win = doc.defaultView,
            html = doc.documentElement,
            left = isBody ?
                // pageXOffset for everything but IE8.
                win.pageXOffset || html.scrollLeft || 0 :
                layer.scrollLeft,
            top = isBody ?
                // pageYOffset for everything but IE8.
                win.pageYOffset || html.scrollTop || 0 :
                layer.scrollTop;
        this.beginPropertyChanges()
                .set( 'scrollLeft', left )
                .set( 'scrollTop', top )
            .endPropertyChanges();
        event.stopPropagation();
    }.on( 'scroll' ),

    preventRootScroll: NS.UA.isIOS ? function ( event ) {
        var view = event.targetView,
            ScrollView = NS.ScrollView,
            doc, win;
        if ( !( view instanceof ScrollView ) &&
                !view.getParent( ScrollView ) ) {
            doc = this.layer.ownerDocument;
            win = doc.defaultView;
            if ( this.get( 'pxHeight' ) <= win.innerHeight &&
                    !/^(?:INPUT|TEXTAREA)$/.test(
                        doc.activeElement.nodeName ) ) {
                event.preventDefault();
            }
        }
    }.on( 'touchmove' ) : null,

    hideAddressBar: function () {
        window.scrollTo( 0, 0 );
    },

    focus: function () {
        var layer = this.get( 'layer' ),
            activeElement = layer.ownerDocument.activeElement,
            view = NS.ViewEventsController.getViewFromNode( activeElement );
        if ( view instanceof NS.AbstractControlView ) {
            view.blur();
        } else if ( activeElement.blur ) {
            activeElement.blur();
        }
    },

    pxTop: 0,
    pxLeft: 0,

    handleEvent: function ( event ) {
        switch ( event.type ) {
        // We observe mousemove when mousedown.
        case 'mousedown':
            this.get( 'layer' ).ownerDocument
                .addEventListener( 'mousemove', this, false );
            break;
        case 'mouseup':
            this.get( 'layer' ).ownerDocument
                .removeEventListener( 'mousemove', this, false );
            break;
        // Window resize events: just notify parent has resized.
        case 'orientationchange':
            this.hideAddressBar();
            /* falls through */
        case 'resize':
            this.didResize();
            return;
        // Scroll events are special.
        case 'scroll':
            this._onScroll( event );
            return;
        }
        NS.ViewEventsController.handleEvent( event, null, this );
    }.invokeInRunLoop()
});

NS.RootView = RootView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ViewEventsController.js                                              \\
// Module: View                                                               \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var etSearch = function ( candidate, b ) {
    var a = candidate[0];
    return a < b ? -1 : a > b ? 1 : 0;
};

/**
    Object: O.ViewEventsController

    Most DOM events are handled via delegation. When an event occurs, it is
    passed to the O.ViewEventsController. This maintains a list of event
    targets that should receive the event before the view handles it, and a list
    of targets that should receive it after it has traversed the view hierarchy.

    When an event is dispatched, it passes through all targets in the first
    list, then is dispatched at the view which owns the node on which the event
    occurred (and will bubble up the view tree from there), then passes through
    all the targets that are queued to handle it after the view. Any event
    handler may call `event.stopPropagation()`, which will stop the view from
    passing to any further targets.

    Standard event target priorities used in library:

    40  - MouseEventRemover
    30  - GestureManager
    20  - DragController
    10  - ModalViewHandler
    -10 - GlobalKeyboardShortcuts

*/
var ViewEventsController = {

    /**
        Property (private): O.ViewEventsController._activeViews
        Type: Object

        Maps from id to the view object for all views currently in a document.
    */
    _activeViews: {},

    /**
        Method: O.ViewEventsController.registerActiveView

        Automatically called when a view is inserted into a document. Adds an
        internal id -> <O.View> mapping.

        Parameters:
            view - {O.View} The view object that has entered the document.

        Returns:
            {O.ViewEventsController} Returns self.
    */
    registerActiveView: function ( view ) {
        this._activeViews[ view.get( 'id' ) ] = view;
        return this;
    },

    /**
        Method: O.ViewEventsController.deregisterActiveView

        Automatically called when a view is removed from a document. Removes an
        internal id -> <O.View> mapping.

        Parameters:
            view - {O.View} The view object that has left the document.

        Returns:
            {O.ViewEventsController} Returns self.
    */
    deregisterActiveView: function ( view ) {
        delete this._activeViews[ view.get( 'id' ) ];
        return this;
    },

    /**
        Method: O.ViewEventsController.getViewFromNode

        Returns the view object that the given DOM node is a part of.

        Parameters:
            node - {Element} a DOM node.

        Returns:
            {O.View|null} The view which owns the node.
    */
    getViewFromNode: function ( node ) {
        var activeViews = this._activeViews,
            doc = node.ownerDocument,
            view = null;
        while ( !view && node && node !== doc ) {
            view = activeViews[ node.id ];
            node = node.parentNode;
        }
        return view;
    },

    /**
        Property (private): O.ViewEventsController._eventTargets
        Type: [Number,O.EventTarget][]

        List of event targets to dispatch events to.
    */
    _eventTargets: [],

    /**
        Method: O.ViewEventsController.addEventTarget

        Adds an event target to queue to receive view events. The position in
        the queue is determined by the priority argument:

        * Greater than 0 => before the view hierarchy receives the event.
        * Less than 0 => after the view hierarchy receives the event.

        If an existing target in the queue has the same priority as the new one,
        the new one will be inserted such that it fires before the old one.

        Parameters:
            eventTarget - {O.EventTarget} The event target to add.
            priority    - {Number} The priority of the event target.

        Returns:
            {O.ViewEventsController} Returns self.
    */
    addEventTarget: function ( eventTarget, priority ) {
        if ( !priority ) { priority = 0; }
        var eventTargets = this._eventTargets,
            index = eventTargets.binarySearch( priority, etSearch ),
            length = eventTargets.length;

        while ( index < length && eventTargets[ index ][0] === priority ) {
            index += 1;
        }

        eventTargets.splice( index, 0, [ priority, eventTarget ] );
        return this;
    },

    /**
        Method: O.ViewEventsController.removeEventTarget

        Removes an event target from the queue that was previously added via
        <O.ViewEventsController.addEventTarget>.

        Parameters:
            eventTarget - {O.EventTarget} The event target to remove from the
                          queue.

        Returns:
            {O.ViewEventsController} Returns self.
    */
    removeEventTarget: function ( eventTarget ) {
        var eventTargets = this._eventTargets,
            l = eventTargets.length;
        while ( l-- ) {
            if ( eventTargets[l][1] === eventTarget ) {
                eventTargets.splice( l, 1 );
            }
        }
        return this;
    },

    /**
        Method: O.ViewEventsController.handleEvent

        Dispatches an event to each of the targets registered with the
        controller, until it reaches the end of the list or one of them calls
        `event.stopPropagation()`.

        Parameters:
            event - {Event} The event object to dispatch.
            view  - {O.View} (optional) The view at which the event originated.
                    This is the view the event will be fired upon after it has
                    been through all the pushed targets. If not supplied, the
                    view will be looked up via the DOM node in the
                    `event.target` property.
    */
    handleEvent: function ( event, view, _rootView ) {
        var eventTargets = this._eventTargets,
            l = eventTargets.length,
            eventTarget;

        if ( !view ) {
            view = this.getViewFromNode( event.target ) || _rootView;
        }
        event.targetView = view;

        while ( l-- ) {
            eventTarget = eventTargets[l][1];
            if ( eventTarget === this ) {
                eventTarget = view;
            }
            if ( eventTarget ) {
                eventTarget.fire( event.type, event );
                if ( event.propagationStopped ) {
                    break;
                }
            }
        }
    }.invokeInRunLoop()
};
ViewEventsController.addEventTarget( ViewEventsController, 0 );

NS.ViewEventsController = ViewEventsController;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: DragEffect.js                                                        \\
// Module: DragDrop                                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

O.DragEffect = {
/**
    Enum: O.DragEffect

    NONE    - No effect when drag released.
    COPY    - Data will be copied to target.
    MOVE    - Data will be moved to target.
    LINK    - Data will be linked to by target.
    ALL     - Data may be copied, moved or linked by target.
    DEFAULT - The default browser action when released.
*/
    NONE: 0,
    COPY: 1,
    MOVE: 2,
    LINK: 4,
    ALL: 1|2|4,
    DEFAULT: 8,

/**
    Property: O.DragEffect.effectToString
    Type: String[]

    Maps bit mask effect to string
*/
    effectToString:  [
        'none',
        'copy',
        'move',
        'copyMove',
        'link',
        'copyLink',
        'linkMove',
        'all',
        ''
    ]
};


// -------------------------------------------------------------------------- \\
// File: Drag.js                                                              \\
// Module: DragDrop                                                           \\
// Requires: DragEffect.js                                                    \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS ) {

/* Issues with native drag and drop.

This system hooks into the native HTML5 drag and drop event system to allow data
to be dragged not just within the window but also between windows and other
applications/the OS itself. However, by default, all drags initiated within the
application will bypass this system and use a custom implementation, as the
native implementation (and indeed the spec) is extremely buggy. Problems (as of
13.05.11) include:

1. If an element is draggable, you cannot select text in any text input area
   underneath it.
2. Webkit sometimes repeatedly fires dragstart events rather than dragover
   events after the first dragstart. This has something to do with setDragImage,
   which also fails in some circumstances.
3. Webkit doesn't like a <canvas> element set as the drag image.
3. In webkit, drags initiated from image elements ignore setDragImage calls
   (http://www.alertdebugging.com/drag-and-drop-bugs/)
4. The spec is still changing from day to day, meaning the browser
   implementations are likely to change as well.
5. In Firefox, setDragImage only works with visible elements.

If you want to initiate a drag with data for an external app (e.g. a file download), you can still do this, by:

1. Setting a draggable="true" attribute on the HTML element to be dragged.
2. Either then setting the data as normal in the dragStarted method (if the view
   includes O.Draggable), or by handling the dragstart event. If the latter,
   you should set the following properties:

   event.dataTransfer.setData( type, data );
   event.dataTransfer.setDragImage( el, offsetX, offsetY );

Native support is turned on for drop targets though, as there are no
show-stopping bugs here, so this is handled as normal.

*/

// Inlined from O.DragEffect
var NONE = 0,
    COPY = 1,
    MOVE = 2,
    LINK = 4,
    ALL = COPY|MOVE|LINK,
    DEFAULT = 8,
    effectToString = NS.DragEffect.effectToString;

/**
    Class: O.Drag

    Extends: O.Object

    Represents a drag operation being performed by a user.
*/
var Drag = NS.Class({

    Extends: NS.Object,

    /**
        Constructor: O.Drag

        Parameters:
            mixin - {Object} Overrides any properties on the object. Must
                    include an `event` property containing the event object that
                    triggered the drag.
    */
    init: function ( mixin ) {
        var event = mixin.event;

        this._dragCursor = null;
        this._stylesheet = null;
        this._scrollBounds = null;
        this._scrollView = null;
        this._scrollBy = null;
        this._scrollInterval = null;
        this._lastTargetView = null;

        this.isNative = false;
        this.dragSource = null;
        this.allowedEffects = ALL;
        this.dataSource = null;
        this.dropTarget = null;
        this.dropEffect = DEFAULT;
        this.cursorPosition = this.startPosition = {
            x: event.clientX,
            y: event.clientY
        };
        this.defaultCursor = 'default';
        this.dragImage = null;

        Drag.parent.init.call( this, mixin );

        this._setCursor( true );
        this.startDrag();
    },

    /**
        Property: O.Drag#isNative
        Type: Boolean

        Is this drag triggered by native drag/drop events rather than mouse
        up/down events?
    */

    /**
        Property: O.Drag#dragSource
        Type: O.View|null

        The view on which the drag was initiated, if initiated in the current
        window. Otherwise null.
    */

    /**
        Property: O.Drag#allowedEffects
        Type: O.DragEffect
        Default: O.DragEffect.ALL

        Which effects (move/copy/link) will the drag source allow the drop
        target to perform with the data represented by this drag.
    */

    /**
        Property: O.Drag#dataSource
        Type: O.DragDataSource|null

        An object providing access to the data represented by the drag. If null,
        the <O.Drag#dragSource> object will be used as the data source if it is
        present and contains the <O.DragDataSource> mixin. Otherwise, the drag
        is presumed not to represent any data.
    */

    /**
        Property: O.Drag#dropTarget
        Type: O.DropTarget|null

        The nearest <O.DropTarget> implementing view (going up the view tree)
        under the mouse cursor at the moment, or null if none of them are drop
        targets.
    */

    /**
        Property: O.Drag#dropEffect
        Type: O.DragEffect
        Default: O.DragEffect.DEFAULT

        The effect of the action that will be performed on the data should a
        drop be performed. This should be set by the current drop target.
    */

    /**
        Property: O.Drag#cursorPosition
        Type: Object

        Contains `x` and `y` values indicating the current cursor position
        relative to the browser window.
    */

    /**
        Property: O.Drag#startPosition
        Type: Object

        Contains `x` and `y` values indicating the cursor position when the drag
        was initiated, relative to the browser window.
    */

    /**
        Property: O.Drag#defaultCursor
        Type: String
        Default: 'default'

        The CSS cursor property value for the cursor to use when no drop effect
        has been set.
    */

    /**
        Property: O.Drag#dragImage
        Type: Element|null

        A DOM element to display next to the cursor whilst the drag is active.
        This could be a simple <img> or <canvas> tag, or a more complicated DOM
        tree.
    */

    /**
        Property: O.Drag#dragImageOffset
        Type: Object
        Default: { x: 5, y: 5 }

        x - {Number} The number of pixels to the right of the cursor at which
            the drag image should begin.
        y - {Number} The number of pixels to the bottom of the cursor at which
            the drag image should begin.
    */
    dragImageOffset: { x: 5, y: 5 },

    /**
        Method (private): O.Drag#_dragImageDidChange

        Observes the <O.Drag#dragImage> property and updates the image being
        dragged if it changes.

        Parameters:
            _        - {*} Ignored.
            __       - {*} Ignored.
            oldImage - {Element|null} The current drag image.
            image    - {Element|null} The new drag image to set.
    */
    _dragImageDidChange: function ( _, __, oldImage, image ) {
        if ( this.isNative ) {
            var offset = this.get( 'dragImageOffset' );
            this.event.dataTransfer.setDragImage( image, offset.x, offset.y );
        } else {
            var dragCursor = this._dragCursor;
            if ( dragCursor ) {
                if ( oldImage ) {
                    dragCursor.removeChild( oldImage );
                }
            } else {
                dragCursor = this._dragCursor = NS.Element.create( 'div', {
                    style: 'position: fixed; z-index: 9999;'
                });
                this._updateDragImagePosition();
                document.body.appendChild( dragCursor );
            }
            dragCursor.appendChild( image );
        }
    }.observes( 'dragImage' ),

    /**
        Method (private): O.Drag#_updateDragImagePosition

        Observes the <O.Drag#cursorPosition> and <O.Drag#dragImageOffset>
        properties and repositions the drag image as appropriate (if it's not a
        native drag, where the browser will automatically update the drag image.
    */
    _updateDragImagePosition: function () {
        var dragImage = this._dragCursor,
            cursor, offset;
        if ( dragImage ) {
            cursor = this.get( 'cursorPosition' );
            offset = this.get( 'dragImageOffset' );
            dragImage.style.left = ( cursor.x + Math.max( offset.x, 5 ) ) + 'px';
            dragImage.style.top = ( cursor.y + Math.max( offset.y, 5 ) ) + 'px';
        }
    }.queue( 'render' ).observes( 'cursorPosition', 'dragImageOffset' ),

    /**
        Method (private): O.Drag#_setCursor

        Sets the on-screen cursor image based on the current dropEffect,
        overriding the normal cursor image.

        Parameters:
            set - {Boolean} If true, the cursor image will be overriden to match
                  the drop effect. If false, it will be set back to the default
                  (e.g. hand when over a link, pointer otherwise).
    */
    _setCursor: function ( set ) {
        var stylesheet = this._stylesheet,
            cursor = this.get( 'defaultCursor' );
        if ( stylesheet ) {
            stylesheet.parentNode.removeChild( stylesheet );
            stylesheet = null;
        }
        if ( set ) {
            switch ( this.get( 'dropEffect' ) ) {
                case NONE:
                    cursor = 'no-drop';
                    break;
                case COPY:
                    cursor = 'copy';
                    break;
                case LINK:
                    cursor = 'alias';
                    break;
            }

            stylesheet = NS.Stylesheet.create( 'o-drag-cursor',
                '*{cursor:default !important;cursor:' + cursor + ' !important;}'
            );
        }
        this._stylesheet = stylesheet;
    }.observes( 'defaultCursor', 'dropEffect' ),

    /**
        Property: O.Drag#dataTypes
        Type: String[]

        An array of the data types available to drop targets of this drag. The
        data type will be the MIME type of the data if a native drag, or a
        custom string if non-native. Native drags representing at least one
        file, will also contain a `'Files'` data type.
    */
    dataTypes: function () {
        var dataSource = this.get( 'dataSource' ) || this.get( 'dragSource' );
        if ( dataSource && dataSource.get( 'isDragDataSource' ) ) {
            return dataSource.get( 'dragDataTypes' );
        }
        if ( this.isNative ) {
            var dataTransfer = this.event.dataTransfer;
            // Current HTML5 DnD interface
            var items = dataTransfer.items,
                types = [],
                hasFiles = false,
                l, item, itemType;
            if ( items ) {
                l = items.length;
                while ( l-- ) {
                    item = items[l];
                    itemType = item.type;
                    if ( !hasFiles ) {
                        hasFiles = ( item.kind === 'file' );
                    }
                    if ( itemType ) {
                        types.include( itemType );
                    }
                }
                if ( hasFiles ) {
                    types.push( 'Files' );
                }
                return types;
            }
            // Deprecated HTML5 DnD interface
            if ( dataTransfer.types ) {
                return Array.prototype.slice.call( dataTransfer.types );
            }
        }
        return [];
    }.property(),

    /**
        Method: O.Drag#hasDataType

        Parameters
            type - {String} The type to test for.

        Returns:
            {Boolean} Does the drag contain data of this type?
    */
    hasDataType: function ( type ) {
        return this.get( 'dataTypes' ).indexOf( type ) !== -1;
    },

    /**
        Method: O.Drag#getFiles

        Parameters
            typeRegExp - {RegExp} (optional) A regular expression to match
                         against the file's MIME type.

        Returns:
            {File[]} An array of all files represented by the drag, or if a
            regular expression is given, an array of all files with a matching
            MIME type.
    */
    getFiles: function ( typeRegExp ) {
        var files = [],
            dataTransfer = this.event.dataTransfer,
            items, i, l, item, itemType;
        if ( dataTransfer ) {
            // Current HTML5 DnD interface
            if ( items = dataTransfer.items ) {
                for ( i = 0, l = items.length; i < l; i += 1 ) {
                    item = items[i];
                    itemType = item.type;
                    if ( item.kind === 'file' ) {
                        // Ignore folders
                        if ( !itemType ) {
                            if ( item.getAsEntry &&
                                    !item.getAsEntry().isFile ) {
                                continue;
                            }
                            else if ( item.webkitGetAsEntry &&
                                    !item.webkitGetAsEntry().isFile ) {
                                continue;
                            }
                        }
                        // Add to files if type matches.
                        if ( !typeRegExp || typeRegExp.test( itemType ) ) {
                            files.push( item.getAsFile() );
                        }
                    }
                }
            }
            // Deprecated HTML5 DnD interface (FF etc.)
            else if ( items = dataTransfer.files ) {
                for ( i = 0, l = items.length; i < l; i += 1 ) {
                    item = items[i];
                    itemType = item.type;
                    // Check it's not a folder (size > 0) and it matches any
                    // type requirements
                    if ( item.size &&
                            ( !typeRegExp || typeRegExp.test( itemType ) ) ) {
                        files.push( item );
                    }
                }
            }
        }
        return files;
    },

    /**
        Method: O.Drag#getDataOfType

        Fetches data of a particular type represented by the drag.

        Parameters
            type     - {String} The type of data to retrieve.
            callback - {Function} A callback to be called with the data as its
                       single argument, or null as the argument if no data
                       available of the requested type. Note, the callback may
                       be made synchronously or asynchronously.

        Returns:
            {O.Drag} Returns self.
    */
    getDataOfType: function ( type, callback ) {
        var dataSource = this.get( 'dataSource' ) || this.get( 'dragSource' ),
            dataFound = false;
        if ( dataSource && dataSource.get( 'isDragDataSource' ) ) {
            callback( dataSource.getDragDataOfType( type, this ) );
            dataFound = true;
        }
        else if ( this.isNative ) {
            var dataTransfer = this.event.dataTransfer,
                items = dataTransfer.items,
                i, l, item;
            // Current HTML5 DnD interface
            if ( items ) {
                for ( i = 0, l = items.length; i < l; i += 1 ) {
                    item = items[i];
                    if ( item.type === type ) {
                        item.getAsString( callback );
                        dataFound = true;
                        break;
                    }
                }
            }
            // Deprecated HTML5 DnD interface
            else if ( dataTransfer.getData ) {
                callback( dataTransfer.getData( type ) );
                dataFound = true;
            }
        }
        if ( !dataFound ) {
            callback( null );
        }
        return this;
    },

    /**
        Method: O.Drag#startDrag

        Called automatically by the init method of the drag to register it with
        the drag controller and set any data on the dataTransfer event property
        if a native drag. It is unlikely you will ever need to call this method
        explicitly.

        Returns:
            {O.Drag} Returns self.
    */
    startDrag: function () {
        NS.DragController.register( this );
        this.fire( 'dragStarted' );
        var dragSource = this.get( 'dragSource' ),
            allowedEffects, dataTransfer, dataSource, dataIsSet, data;
        // No drag source if drag started in another window/app.
        if ( dragSource ) {
            dragSource.set( 'isDragging', true ).dragStarted( this );

            allowedEffects = dragSource.get( 'allowedDragEffects' );
            this.set( 'allowedEffects', allowedEffects );

            // Native DnD support.
            if ( this.isNative ) {
                dataTransfer = this.event.dataTransfer;
                dataSource = this.get( 'dataSource' ) || dragSource;
                dataIsSet = false;

                dataTransfer.effectAllowed =
                    effectToString[ this.get( 'allowedEffects' ) ];

                if ( dataSource.get( 'isDragDataSource' ) ) {
                    dataSource.get( 'dragDataTypes' )
                              .forEach( function ( type ) {
                        if ( type.contains( '/' ) ) {
                            data = dataSource.getDragDataOfType( type, this );
                            // Current HTML5 DnD interface
                            if ( dataTransfer.items ) {
                                dataTransfer.items.add( data, type );
                            }
                            // Deprecated HTML5 DnD interface
                            else if ( dataTransfer.setData ) {
                                dataTransfer.setData( type, data );
                            }
                            dataIsSet = true;
                        }
                    });
                }

                // Need something to keep the drag alive
                if ( !dataIsSet ) {
                    dataTransfer.setData( 'x-private', '' );
                }
            }
        }
        return this;
    },

    /**
        Method: O.Drag#endDrag

        If the drag is in progress, you can call this to cancel the drag
        operation. Otherwise it will be called automatically when the drag is
        finished (i.e. when the user releases the mouse or moves it out of the
        browser window).

        The method will clean up after a drag, resetting the cursor back to
        normal, informing the current drop target and drag source that the drag
        is finished and deregistering with the drag controller.

        Returns:
            {O.Drag} Returns self.
    */
    endDrag: function () {
        var dropTarget = this.get( 'dropTarget' ),
            dragSource = this.get( 'dragSource' );
        if ( dropTarget ) {
            dropTarget.dropExited( this );
        }
        if ( dragSource ) {
            dragSource.set( 'isDragging', false ).dragEnded( this );
        }

        if ( this._dragCursor ) {
            document.body.removeChild( this._dragCursor );
            this._dragCursor = null;
        }
        if ( this._scrollInterval ) {
            NS.RunLoop.cancel( this._scrollInterval );
            this._scrollInterval = null;
        }
        this._setCursor( false );

        this.fire( 'dragEnded' );
        NS.DragController.deregister( this );

        return this;
    },

    /**
        Method: O.Drag#move

        Called automatically by the drag controller whenever the mouse moves
        whilst the drag is in progress. Gets the updated cursor position,
        recalculates the drop target and scrolls scroll views if hovering near
        the edge.

        Parameters:
            event - {Event} The dragover or mousemove event.

        Returns:
            {O.Drag} Returns self.
    */
    move: function ( event ) {
        this.event = event;

        // Find which view is currently under the cursor. If none, presume we've
        // moved the cursor over the drag image, so we're probably still over
        // the current drop.
        var view = event.targetView,
            x, y;
        if ( !view ) {
            view = this.get( 'dropTarget' );
        }

        // Update cursor location
        this.set( 'cursorPosition', {
            x: x = event.clientX,
            y: y = event.clientY
        });

        // Check if we're over any hotspots that should trigger a scroll.
        this._check( view, x, y );

        // Recalculate drop target and update.
        this._update( view );

        return this;
    },

    /**
        Property (private): O.Drag#_scrollBounds
        Type: Object|null

        An object caching the position of the scroll view on the screen.
    */

    /**
        Property (private): O.Drag#_scrollView
        Type: O.ScrollView|null

        The scroll view under the cursor, if any.
    */

    /**
        Property (private): O.Drag#_scrollBy
        Type: Object|null

        An object with `x` and `y` properties containing the number of pixels
        the scroll view should be scrolled in the next frame (negative values to
        scroll up, positive values to scroll down).
    */

    /**
        Property (private): O.Drag#_scrollInterval
        Type: InvocationToken|null

        The InvocationToken returned by a call to <O.RunLoop.cancel>.
    */

    /**
        Property (private): O.Drag#_lastTargetView
        Type: O.View|null

        The view the mouse was over last time <O.Drag#_check> was called.
    */

    /**
        Method (private): O.Drag#_check

        Checks if the mouse is currently near the edge of a scroll view, and if
        so, sets that to scroll automatically.

        Parameters
            view - {O.View} The view the mouse is currently over.
            x    - The current x-coordinate of the mouse.
            y    - The current y-coordinate of the mouse.
    */
    _check: function ( view, x, y ) {
        var scroll = this._scrollBounds,
            scrollView = this._scrollView,
            outsideTriggerRegionWidth = 15,
            bounds, deltaX, deltaY;

        // If we don't have any containing scroll container bounds, recalculate.
        if ( !scroll ||
                x < scroll.l || x > scroll.r || y < scroll.t || y > scroll.b ) {
            scroll = null;
            // Optimise by only reclaculating scrollView bounds when we mouse
            // over a new view.
            if ( view && this._lastTargetView !== view ) {
                this._lastTargetView = scrollView = view;

                if ( !( scrollView instanceof NS.ScrollView ) ) {
                    scrollView = scrollView.getParent( NS.ScrollView );
                }
                if ( scrollView ) {
                    bounds = scrollView.get( 'layer' ).getBoundingClientRect();
                    scroll = {
                        l: bounds.left - outsideTriggerRegionWidth,
                        r: bounds.right + outsideTriggerRegionWidth,
                        t: bounds.top - outsideTriggerRegionWidth,
                        b: bounds.bottom + outsideTriggerRegionWidth
                    };
                    // IE8 doesn't support bounds.(width|height)
                    deltaX = Math.min( 75, (bounds.right - bounds.left) >> 2 );
                    deltaY = Math.min( 75, (bounds.bottom - bounds.top) >> 2 );
                    scroll.hl = scroll.l + deltaX;
                    scroll.hr = scroll.r - deltaX;
                    scroll.ht = scroll.t + deltaY;
                    scroll.hb = scroll.b - deltaY;
                }
                this._scrollView = scrollView;
                this._scrollBounds = scroll;
            }
        }
        // Clear the timer if we used to be in a hotspot.
        if ( this._scrollInterval ) {
            NS.RunLoop.cancel( this._scrollInterval );
            this._scrollInterval = null;
        }
        // And set a new timer if we are currently in a hotspot.
        if ( scroll ) {
            deltaX = x < scroll.hl ? -10 : x > scroll.hr ? 10 : 0;
            deltaY = y < scroll.ht ? -10 : y > scroll.hb ? 10 : 0;
            if ( deltaX || deltaY ) {
                this._scrollBy = { x: deltaX, y: deltaY };
                this._scrollInterval =
                    NS.RunLoop.invokePeriodically( this._scroll, 100, this );
            }
        }
    },

    /**
        Method (private): O.Drag#_scroll

        Moves the scroll position of the scroll view currently being hovered
        over.
    */
    _scroll: function () {
        var scrollView = this._scrollView,
            scrollBy = this._scrollBy;

        if ( scrollView.scrollBy( scrollBy.x, scrollBy.y ) ) {
            var cursor = this.get( 'cursorPosition' ),
                target = document.elementFromPoint( cursor.x, cursor.y );
            if ( target ) {
                this._update( NS.ViewEventsController.getViewFromNode( target ) );
            }
        }
    },

    /**
        Method (private): O.Drag#_update

        Finds the current drop target and invokes the appropriate callbacks on
        the drag source and old/new drop targets.

        Parameters:
            view - {O.View} The view the mouse is currently over.
    */
    _update: function ( view ) {
        var currentDrop = this.get( 'dropTarget' ),
            dragSource = this.get( 'dragSource' );

        // Find the current drop Target
        while ( view ) {
            if ( view === currentDrop || (
                    view.get( 'isDropTarget' ) &&
                    view.willAcceptDrag( this ) ) ) {
                break;
            }
            view = view.get( 'parentView' ) || null;
        }

        // Update targets on status
        if ( view !== currentDrop ) {
            if ( currentDrop ) {
                currentDrop.dropExited( this );
            }
            if ( view ) {
                view.dropEntered( this );
            }
            currentDrop = view;
            this.set( 'dropTarget', view );
        }
        if ( currentDrop ) {
            currentDrop.dropMoved( this );
        }

        // Update source on status
        if ( dragSource ) {
            dragSource.dragMoved( this );
        }
    },

    /**
        Method: O.Drag#drop

        Called automatically by the drag controller when a drop event occurs. If
        over a drop target, and the drop effect is not NONE, calls the
        <O.DropTarget#drop> method on the target.

        Parameters:
            event - {Event} The drop or mouseup event.

        Returns:
            {O.Drag} Returns self.
    */
    drop: function ( event ) {
        this.event = event;
        var dropEffect = this.dropEffect;
        if ( this.dropTarget &&
                dropEffect !== NONE && dropEffect !== DEFAULT ) {
            this.dropTarget.drop( this );
        }
        return this;
    }
});

NS.Drag = Drag;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: DragController.js                                                    \\
// Module: DragDrop                                                           \\
// Requires: View, DragEffect.js                                              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS ) {

var isControl = {
    BUTTON: 1,
    INPUT: 1,
    OPTION: 1,
    SELECT: 1,
    TEXTAREA: 1
};
var effectToString = NS.DragEffect.effectToString;
var DEFAULT = NS.DragEffect.DEFAULT;

function TouchDragEvent ( touch ) {
    var clientX = touch.clientX,
        clientY = touch.clientY,
        target = document.elementFromPoint( clientX, clientY ) || touch.target;
    this.touch = touch;
    this.clientX = clientX;
    this.clientY = clientY;
    this.target = target;
    this.targetView = NS.ViewEventsController.getViewFromNode( target );
}

var getTouch = function ( event, touchId ) {
    var touches = event.changedTouches,
        l = touches.length,
        touch;
    while ( l-- ) {
        touch = touches[l];
        if ( touch.identifier === touchId ) {
            return touch;
        }
    }
    return null;
};

/**
    Class: O.DragController

    This singleton manages drag and drop events, normalising native drag and
    drop with mouse(down|move|up) simulated drag and drop. It creates instances
    of <O.Drag> and dispatches events to them as necessary.

    It is unlikely that an application need interface with this object directly.
    The <O.Draggable>, <O.DragDataSource> and <O.DropTarget> mixins are used to
    add the required properties to views, and an instance of <O.Drag> gives all
    the information about the drag.
*/
var DragController = new NS.Object({
    /**
        Property (private): O.DragController._x
        Type: Number

        The (screen-based) x coordinate of the mouse when the last mousedown
        event fired. Used to detect if the mouse has moved sufficiently whilst
        down to initiate a drag.
    */
    _x: 0,

    /**
        Property (private): O.DragController._y
        Type: Number

        The (screen-based) y coordinate of the mouse when the last mousedown
        event fired. Used to detect if the mouse has moved sufficiently whilst
        down to initiate a drag.
    */
    _y: 0,

    /**
        Property (private): O.DragController._targetView
        Type: O.View|null

        The <O.View> instance on which the mousedown event occurred. Used to
        determine the target view to trigger a simulated drag event.
    */
    _targetView: null,

    /**
        Property (private): O.DragController._ignore
        Type: Boolean

        If true, drag events will not be initiated on mousemove. Is set to true
        whilst the mouse is down (unless it was inside a control), until the
        mouse is up again or a drag is initiated.
    */
    _ignore: true,

    /**
        Property (private): O.DragController._touchId
        Type: String|null

        If a touch-inited drag is in progress, this holds the identifier of the
        touch being tracked
    */
    _touchId: null,

    /**
        Property (private): O.DragController._drag
        Type: O.Drag|null

        If a drag is in progress, this holds the current <O.Drag> instance.
    */
    _drag: null,

    /**
        Method: O.DragController.register

        Called by a new O.Drag instance when it is created to set it as the
        handler for all future drag events. Ends any previous drag if still
        active.

        Parameters:
            drag - {O.Drag} The new drag instance.
    */
    register: function ( drag ) {
        if ( this._drag ) {
            this._drag.endDrag();
        }
        this._drag = drag;
    },

    /**
        Method: O.DragController.deregister

        Called by a new O.Drag instance when it is finished to deregister from
        future drag events.

        Parameters:
            drag - {O.Drag} The finished drag instance.
    */
    deregister: function ( drag ) {
        if ( this._drag === drag ) {
            this._drag = null;
            this._touchId = null;
        }
    },

    /**
        Method: O.DragController.getNearestDragView

        Parameters:
            view - {O.View}

        Returns:
            {O.View|null} The view passed in or the nearest parent view of that
            (going up the tree) which is draggable. A view is draggable if it
            includes the <O.Draggable> mixin.
    */
    getNearestDragView: function ( view ) {
        while ( view ) {
            if ( view.get( 'isDraggable' ) ) {
                break;
            }
            view = view.get( 'parentView' ) || null;
        }
        return view;
    },

    /**
        Method: O.DragController.handleEvent

        Handler for native events. Fires an equivalent <O.EventTarget> event.

        Parameters:
            event - {Event}
    */
    handleEvent: function ( event ) {
        this.fire( event.type, event );
    }.invokeInRunLoop(),

    // === Non-native mouse API version ===

    /**
        Method (private): O.DragController._onMousedown

        Tracks mousedown events so that simulated drag events can be dispatched
        when a drag gesture is detected.

        Parameters:
            event - {Event} The mousedown event.
    */
    _onMousedown: function ( event ) {
        if ( event.button || event.metaKey || event.ctrlKey ) { return; }
        if ( isControl[ event.target.nodeName ] ) {
            this._ignore = true;
        } else {
            this._x = event.clientX;
            this._y = event.clientY;
            this._targetView = event.targetView;
            this._ignore = false;
        }
    }.on( 'mousedown' ),

    /**
        Method (private): O.DragController._onMousemove

        Tracks mousemove events and creates a new <O.Drag> instance if a drag
        gesture is detected, or passes the move event to an existing drag.

        Parameters:
            event - {Event} The mousemove event.
    */
    _onMousemove: function ( event ) {
        var drag = this._drag;
        if ( drag && !this._touchId ) {
            // Mousemove should only be fired if not native DnD, but sometimes
            // is fired even when there's a native drag
            if ( !drag.get( 'isNative' ) ) {
                drag.move( event );
            }
            // If mousemove during drag, don't propagate to views (for
            // consistency with native DnD).
            event.stopPropagation();
        } else if ( !this._ignore ) {
            var x = event.clientX - this._x,
                y = event.clientY - this._y,
                view;

            if ( ( x*x + y*y ) > 25 ) {
                view = this.getNearestDragView( this._targetView );
                if ( view ) {
                    new NS.Drag({
                        dragSource: view,
                        event: event,
                        startPosition: {
                            x: this._x,
                            y: this._y
                        }
                    });
                }
                this._ignore = true;
            }
        }
    }.on( 'mousemove' ),

    /**
        Method (private): O.DragController._onMouseup

        Tracks mouseup events to end simulated drags.

        Parameters:
            event - {Event} The mouseup event.
    */
    _onMouseup: function ( event ) {
        this._ignore = true;
        this._targetView = null;
        // Mouseup will not fire if native DnD
        var drag = this._drag;
        if ( drag && !this._touchId ) {
            drag.drop( event ).endDrag();
        }
    }.on( 'mouseup' ),

    // === Non-native touch API version ===

    /**
        Method (private): O.DragController._onHold

        Parameters:
            event - {Event} The hold event.
    */
    _onHold: function ( event ) {
        var touch = event.touch,
            touchEvent = new TouchDragEvent( touch ),
            view = this.getNearestDragView( touchEvent.targetView );
        if ( view && !isControl[ touchEvent.target.nodeName ] ) {
            this._drag = new NS.Drag({
                dragSource: view,
                event: touchEvent
            });
            this._touchId = touch.identifier;
        }
    }.on( 'hold' ),

    /**
        Method (private): O.DragController._onTouchemove

        Parameters:
            event - {Event} The touchmove event.
    */
    _onTouchmove: function ( event ) {
        var touchId = this._touchId,
            touch;
        if ( touchId ) {
            touch = getTouch( event, touchId );
            if ( touch ) {
                this._drag.move( new TouchDragEvent( touch ) );
                // Don't propagate to views and don't trigger scroll.
                event.preventDefault();
                event.stopPropagation();
            }
        }
    }.on( 'touchmove' ),

    /**
        Method (private): O.DragController._onTouchend

        Parameters:
            event - {Event} The touchend event.
    */
    _onTouchend: function ( event ) {
        var touchId = this._touchId,
            touch;
        if ( touchId ) {
            touch = getTouch( event, touchId );
            if ( touch ) {
                this._drag.drop( new TouchDragEvent( touch ) ).endDrag();
            }
        }
    }.on( 'touchend' ),

    /**
        Method (private): O.DragController._onTouchcancel

        Parameters:
            event - {Event} The touchcancel event.
    */
    _onTouchcancel: function ( event ) {
        var touchId = this._touchId,
            touch;
        if ( touchId ) {
            touch = getTouch( event, touchId );
            if ( touch ) {
                this._drag.endDrag();
            }
        }
    }.on( 'touchcancel' ),

    // === Native API version ===

    /**
        Method (private): O.DragController._onDragstart

        Tracks dragstart events to create a new <O.Drag> instance.

        Parameters:
            event - {Event} The dragstart event.
    */
    _onDragstart: function ( event ) {
        // Ignore any implicit drags; only use native API when draggable="true"
        // is explicitly set
        var target = event.target,
            explicit = false;
        while ( target && target.getAttribute ) {
            if ( target.getAttribute( 'draggable' ) === 'true' ) {
                explicit = true;
                break;
            }
            target = target.parentNode;
        }
        if ( !explicit ) {
            event.preventDefault();
        } else {
            new NS.Drag({
                dragSource: this.getNearestDragView( event.targetView ),
                event: event,
                isNative: true
            });
        }
    }.on( 'dragstart' ),

    /**
        Method (private): O.DragController._onDragover

        Tracks dragover events to pass mouse movement to the <O.Drag> instance.

        Parameters:
            event - {Event} The dragover event.
    */
    _onDragover: function ( event ) {
        var drag = this._drag,
            dataTransfer = event.dataTransfer,
            notify = true,
            dropEffect;
        // Probably hasn't come via root view controller, so doesn't have target
        // view property
        if ( !event.targetView ) {
            event.targetView =
                NS.ViewEventsController.getViewFromNode( event.target );
        }
        if ( !drag ) {
            // Drag from external source:
            drag = new NS.Drag({
                event: event,
                isNative: true,
                allowedEffects:
                    effectToString.indexOf( dataTransfer.effectAllowed )
            });
        } else {
            var x = event.clientX,
                y = event.clientY;
            if ( this._x === x && this._y === y ) {
                notify = false;
            } else {
                this._x = x;
                this._y = y;
            }
        }
        if ( notify ) {
            drag.move( event );
        }
        dropEffect = drag.get( 'dropEffect' );
        if ( dropEffect !== DEFAULT ) {
            dataTransfer.dropEffect =
                effectToString[ dropEffect & drag.get( 'allowedEffects' ) ];
            event.preventDefault();
        }
    }.on( 'dragover' ),

    /**
        Property (private): O.DragController._nativeRefCount
        Type: Number

        A reference count, incremented each time we see a dragenter event and
        decremented each time we see a dragleave event.

        If a native drag starts outside the window, we never get a dragend
        event. Instead we need to keep track of the dragenter/dragleave calls.
        The drag enter event is fired before the drag leave event (see
        http://dev.w3.org/html5/spec/dnd.html#drag-and-drop-processing-model),
        so when the count gets down to zero it means the mouse has left the
        actual window and so we can end the drag.
    */
    _nativeRefCount: 0,

    /**
        Method (private): O.DragController._onDragenter

        Tracks dragenter events to increment the
        <O.DragController._nativeRefCount> refcount.

        Parameters:
            event - {Event} The dragenter event.
    */
    _onDragenter: function (/* event */) {
        this._nativeRefCount += 1;
    }.on( 'dragenter' ),

    /**
        Method (private): O.DragController._onDragleave

        Tracks dragleave events to decrement the
        <O.DragController._nativeRefCount> refcount, and end the drag if it gets
        down to 0 (as this means the drag has left the browser window).

        Parameters:
            event - {Event} The dragleave event.
    */
    _onDragleave: function (/* event */) {
        var drag = this._drag;
        if ( !( this._nativeRefCount -= 1 ) && drag ) {
            drag.endDrag();
        }
    }.on( 'dragleave' ),

    /**
        Method (private): O.DragController._onDrop

        Tracks drop events to pass them to the active <O.Drag> instance.

        Parameters:
            event - {Event} The drop event.
    */
    _onDrop: function ( event ) {
        var drag = this._drag;
        if ( drag ) {
            if ( drag.get( 'dropEffect' ) !== DEFAULT ) {
                event.preventDefault();
            }
            // Dragend doesn't fire if the drag didn't start
            // inside the window, so we also call drag end on drop.
            drag.drop( event ).endDrag();
        }
    }.on( 'drop' ),

    /**
        Method (private): O.DragController._onDragend

        Tracks dragend events to pass them to the active <O.Drag> instance.

        Parameters:
            event - {Event} The dragend event.
    */
    _onDragend: function (/* event */) {
        var drag = this._drag;
        if ( drag ) {
            drag.endDrag();
        }
    }.on( 'dragend' ),

    // === Cancel on escape ===

    /**
        Method (private): O.DragController._escCancel

        Cancels the drag if the escape key is hit whilst the drag is in
        progress.

        Parameters:
            event - {Event} The keydown event.
    */
    _escCancel: function ( event ) {
        var drag = this._drag;
        if ( drag && NS.DOMEvent.lookupKey( event ) === 'esc' ) {
            drag.endDrag();
        }
    }.on( 'keydown' )
});

[ 'dragover', 'dragenter', 'dragleave', 'drop', 'dragend' ]
    .forEach( function ( type ) {
        document.addEventListener( type, DragController, false );
    });

NS.ViewEventsController.addEventTarget( DragController, 20 );

NS.DragController = DragController;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: DragDataSource.js                                                    \\
// Module: DragDrop                                                           \\
// Requires: DragEffect.js                                                    \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.DragDataSource

    Represents a set of data for a drag operation. This can either be
    instantiated like so:

        var ddsource = new O.DragDataSource({
            'text/plain': 'My *data*',
            'text/html': 'My <strong>data</strong>'
        });

    or used as a mixin in another class.
*/
NS.DragDataSource = {
    /**
        Constructor: O.DragDataSource

        Parameters:
            dragData - {Object} An object with data types as keys and the data
                       itself as the values.
    */
    init: function ( dragData ) {
        if ( !dragData ) { dragData = {}; }
        this._dragData = dragData;
        this.dragDataTypes = Object.keys( dragData );
        this.get = function ( key ) {
            return this[ key ];
        };
    },

    /**
        Property: O.DragDataSource#isDragDataSource
        Type: Boolean
        Default: true

        Identifies the object as a drag data source, even if used as a mixin.
    */
    isDragDataSource: true,

    /**
        Property: O.DragDataSource#allowedDragEffects
        Type: O.DragEffect
        Default: O.DragEffect.ALL

        The effects allowed on the data.
    */
    allowedDragEffects: NS.DragEffect.ALL,

    /**
        Property: O.DragDataSource#dragDataTypes
        Type: String[]

        The list of data types available in this data source.
    */
    dragDataTypes: [],

    /**
        Method: O.DragController.getDragDataOfType

        Parameters:
            type - {String} The data type required.
            drag - {O.Drag} The drag instance representing the data.

        Returns:
            {*} The data of the requested type, if available.
    */
    getDragDataOfType: function ( type/*, drag*/ ) {
        return this._dragData[ type ];
    }
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Draggable.js                                                         \\
// Module: DragDrop                                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Mixin: O.Draggable

    The Draggable mixin should be applied to views you wish to make draggable.
    Override the methods to get the callbacks you're interested in.
*/
NS.Draggable = {
    /**
        Property: O.Draggable#isDraggable
        Type: Boolean
        Default: true

        Identifies the view as draggable.
    */
    isDraggable: true,

    /**
        Property: O.Draggable#isDragging
        Type: Boolean

        True if the view is currently being dragged.
    */
    isDragging: false,

    /**
        Method: O.Draggable#dragStarted

        Called when a drag is initiated with this view.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dragStarted: function (/* drag */) {},

    /**
        Method: O.Draggable#dragMoved

        Called when a drag initiated with this view moves.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dragMoved: function (/* drag */) {},

    /**
        Method: O.Draggable#dragEnded

        Called when a drag initiated with this view finishes (no matter where on
        screen it finishes). This method is guaranteed to be called, if and only
        if dragStarted was called on the same view.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dragEnded: function (/* drag */) {}
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: DropTarget.js                                                        \\
// Module: DragDrop                                                           \\
// Requires: DragEffect.js                                                    \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Mixin: O.DropTarget

    The DropTarget mixin should be applied to views you wish to make drop
    targets.
*/
NS.DropTarget = {
    /**
        Property: O.DropTarget#isDropTarget
        Type: Boolean
        Default: true

        Identifies the view as a drop target.
    */
    isDropTarget: true,

    /**
        Property: O.DropTarget#hasDragOver
        Type: Boolean

        True if the view is a drag is currently over the view.
    */
    hasDragOver: false,

    /**
        Property: O.DropTarget#dropEffect
        Type: O.DragEffect
        Default: O.DragEffect.MOVE

        The effect that will be applied to the data if dropped.
    */
    dropEffect: NS.DragEffect.MOVE,

    /**
        Property: O.DropTarget#dropAcceptedDataTypes
        Type: Object

        An object mapping data types the drop target can handle to a truthy
        value.
    */
    dropAcceptedDataTypes: {},

    /**
        Method: O.DropTarget#willAcceptDrag

        When a drag moves over the drop target, this method will be called to
        determine whether the target is willing to accept the drag. If it
        returns true, it will become the active drop target. If it returns
        false, it will be ignored, and any parent views which are drop targets
        will be considered instead.

        Unless overridden, this method simply checks whether any of the data
        types available in the drag are included in its dropAcceptedDataTypes
        property.

        Parameters:
            drag - {O.Drag} The drag instance.

        Returns:
            {Boolean} Can the drag be dropped here?
    */
    willAcceptDrag: function ( drag ) {
        var acceptedTypes = this.get( 'dropAcceptedDataTypes' ),
            availableTypes = drag.get( 'dataTypes' ),
            l = availableTypes.length;
        while ( l-- ) {
            if ( acceptedTypes[ availableTypes[l] ] ) {
                return true;
            }
        }
        return false;
    },

    /**
        Method: O.DropTarget#dropEntered

        Called when a drag instance enters the view. If this method is called,
        the dropExited method is guaranteed to be called later.

        Sets the drop effect on the drag instance and updates the hasDragOver
        property.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dropEntered: function ( drag ) {
        drag.set( 'dropEffect', this.get( 'dropEffect' ) );
        this.set( 'hasDragOver', true );
    },

    /**
        Method: O.DropTarget#dropMoved

        Called when a drag instance that has entered the view moves position
        (without exiting the view).

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dropMoved: function (/* drag */) {},

    /**
        Method: O.DropTarget#dropExited

        Called when a drag instance exits the view.

        Resets the drop effect on the drag instance and updates the hasDragOver
        property.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dropExited: function ( drag ) {
        drag.set( 'dropEffect', NS.DragEffect.DEFAULT );
        this.set( 'hasDragOver', false );
    },

    /**
        Method: O.DropTarget#drop

        Called when a drag instance is dropped on the view.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    drop: function (/* drag */) {}
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: XHR.js                                                               \\
// Module: IO                                                                 \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global XMLHttpRequest, FormData, location */

( function ( NS ) {

var isLocal = location.protocol === 'file:';

var parseHeaders = function ( allHeaders ) {
    var headers = {},
        start = 0,
        end, name;
    while ( true ) {
        // Ignore any leading white space
        while ( /\s/.test( allHeaders.charAt( start ) ) ) {
            start += 1;
        }
        // Look for ":"
        end = allHeaders.indexOf( ':', start );
        if ( end < 0 ) {
            break;
        }
        // Slice out the header name
        name = allHeaders.slice( start, end );
        // Trim off any spaces after the colon.
        start = end + 1;
        while ( allHeaders.charAt( start ) === ' ' ) {
            start += 1;
        }
        // And find the end of the header
        end = allHeaders.indexOf( '\n', start );
        if ( end < 0 ) {
            end = allHeaders.length;
        }
        // Trim any trailing white space
        while ( end > start && /\s/.test( allHeaders.charAt( end - 1 ) ) ) {
            end -= 1;
        }
        // Add to the headers object
        headers[ name ] = allHeaders.slice( start, end );
        // And start looking for the next header
        start = end + 1;
    }
    return headers;
};

/**
    Class: O.XHR

    Wrapper class for the native XMLHTTPRequest object in the browser. Hooks
    into the more fully featured <O.HttpRequest> class; you should use that
    class for most things.
*/
var XHR = NS.Class({
    /**
        Property: O.XHR#io
        Type: (O.Object|null)

        Reference to object on which properties are set and events fired.
    */

    /**
        Property (private): O.XHR#_isRunning
        Type: Boolean

        Is a request in progress?
    */

    /**
        Property: O.XHR#makeAsyncRequests
        Type: Boolean
        Default: true

        If changed to false, the connections will be synchronous rather than
        async. This should *only* ever be set during the onunload event,
        where you need to make a request synchronous to ensure it completes
        before the tab process is killed.
    */
    makeAsyncRequests: true,

    /**
        Constructor: O.XHR

        Parameters:
            io - {O.Object} (optional).
    */
    init: function ( io ) {
        var xhr = new XMLHttpRequest();
        this._isRunning = false;
        this._status = 0;
        this.io = io || null;
        this.xhr = xhr;
        if ( xhr.upload ) {
            xhr.upload.addEventListener( 'progress', this, false );
            xhr.addEventListener( 'progress', this, false );
        }
    },

    destroy: function () {
        this.abort();
        var xhr = this.xhr;
        if ( xhr.upload ) {
            xhr.upload.removeEventListener( 'progress', this, false );
            xhr.removeEventListener( 'progress', this, false );
        }
    },

    /**
        Method: O.XHR#isRunning

        Determines whether a request is currently in progress.

        Returns:
            {Boolean} Is there a request still in progress?
    */
    isRunning: function () {
        return !!this._isRunning;
    },

    /**
        Method: O.XHR#getHeader

        Returns the contents of the response header corresponding to the name
        supplied as a parameter to the method.

        Parameters:
            name - {String} The name of the header to be fetched.

        Returns:
            {String} The text of the header or the empty string if not found.
    */
    getHeader: function ( name ) {
        var header;
        try {
            header = this.xhr.getResponseHeader( name );
        } catch ( error ) {}
        return header || '';
    },

    /**
        Method: O.XHR#getResponse

        Returns the full text of the response to the request.

        Returns:
            {String} The response text.
    */
    getResponse: function () {
        // Internet Explorer may throw an error if you try to read the
        // responseText before it is in readyState 4.
        var response = '';
        try {
            response = this.xhr.responseText;
        } catch ( error ) {}
        return response || '';
    },

    /**
        Method: O.XHR#getResponseType

        Returns the MIME type of the response, according to the Content-type
        header set by the server.

        Returns:
            {String} The MIME type of the response.
    */
    getResponseType: function () {
        return this.getHeader( 'Content-type' );
    },

    /**
        Method: O.XHR#getStatus

        Returns the HTTP status code returned by the server in response to the
        request.

        Returns:
            {Number} The HTTP status code
    */
    getStatus: function () {
        return this._status;
    },

    /**
        Method: O.XHR#send

        If a request is currently active, it is first aborted. A new request is
        then made to the server, using the parameters supplied.

        Parameters:
            method  - {String} The HTTP method to use ('GET' or 'POST').
            url     - {String} The URL to which the request is to be made. This
                      must be at the same domain as the current page or a
                      security error will be thrown.
            data    - {String} The data to send in the body of the request; only
                      valid for POST requests; this will be ignored if the
                      method is GET.
            headers - {Object} (Optional) A set of key:value pairs corresponding
                      to header names and their values which will be sent with
                      the request.

        Returns:
            {O.XHR} Returns self.
    */
    send: function ( method, url, data, headers ) {
        if ( this._isRunning ) {
            this.abort();
        }
        this._isRunning = true;

        var xhr = this.xhr,
            io = this.io,
            that = this,
            name;

        xhr.open( method, url, this.makeAsyncRequests );
        for ( name in headers || {} ) {
            // Let the browser set the Content-type automatically if submitting
            // FormData, otherwise it might be missing the boundary marker.
            if ( name !== 'Content-type' || !( data instanceof FormData ) ) {
                xhr.setRequestHeader( name, headers[ name ] );
            }
        }
        xhr.onreadystatechange = function () {
            that._xhrStateDidChange( this );
        };
        xhr.send( data );

        if ( io ) {
            io.fire( 'io:begin' );
        }

        return this;
    },

    /**
        Method (private): O.XHR#_xhrStateDidChange

        Determines the state of the XMLHttpRequest object and fires the
        appropriate callbacks when it is loading/finished.

        Parameters:
            xhr - {XMLHttpRequest} The object whose state has changed.
    */
    _xhrStateDidChange: function ( xhr ) {
        var state = xhr.readyState,
            io = this.io,
            status, allHeaders, isSuccess,
            responseHeaders, responseType, response;
        if ( state < 3 || !this._isRunning ) { return; }

        if ( state === 3 ) {
            if ( io ) {
                io.set( 'uploadProgress', 100 )
                  .fire( 'io:loading' );
            }
            return;
        }

        this._isRunning = false;
        xhr.onreadystatechange = function () {};

        status = xhr.status;
        this._status = status =
            // IE8 translates response code 204 to 1223
            ( status === 1223 ) ? 204 :
            // Local requests will have a 0 response
            ( !status && isLocal ) ? 200 :
            status;

        if ( io ) {
            allHeaders = xhr.getAllResponseHeaders();
            // IE returns 200 status code when there's no network! But for a
            // real connection there must have been at least one header, so
            // check that's not empty
            isSuccess = !!allHeaders && ( status >= 200 && status < 300 );
            responseHeaders = parseHeaders( allHeaders );
            responseType = this.getResponseType();
            response = this.getResponse();
            io.set( 'uploadProgress', 100 )
              .set( 'progress', 100 )
              .set( 'status', status )
              .set( 'responseHeaders', responseHeaders )
              .set( 'responseType', responseType )
              .set( 'response', response )
              .fire( isSuccess ? 'io:success' : 'io:failure', {
                status: status,
                headers: responseHeaders,
                type: responseType,
                data: response
              })
              .fire( 'io:end' );
        }
    }.invokeInRunLoop(),

    handleEvent: function ( event ) {
        var io = this.io,
            type;
        if ( io && event.type === 'progress' ) {
            type = event.target === this.xhr ? 'progress' : 'uploadProgress';
            // CORE-47058. Limit to 99% on progress events, as Opera can report
            // event.loaded > event.total! Will be set to 100 in onSuccess
            // handler.
            io.set( type, Math.min( 99,
                    ~~( ( event.loaded / event.total ) * 100 ) ) )
              .fire( 'io:' + type, event );
        }
    }.invokeInRunLoop(),

    /**
        Method: O.XHR#abort

        Aborts the currently active request. No further callbacks will be made
        for that request. If there is no active request, calling this method has
        no effect.

        Returns:
            {O.XHR} Returns self.
    */
    abort: function () {
        if ( this._isRunning ) {
            this._isRunning = false;
            var xhr = this.xhr,
                io = this.io;
            xhr.abort();
            xhr.onreadystatechange = function () {};
            if ( io ) {
                io.fire( 'io:abort' )
                  .fire( 'io:end' );
            }
        }
        return this;
    }
});

NS.XHR = XHR;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: EventSource.js                                                       \\
// Module: IO                                                                 \\
// Requires: Core, Foundation, UA, XHR.js                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global EventSource */

( function ( NS, NativeEventSource ) {

var CONNECTING = 0;
var OPEN = 1;
var CLOSED = 2;

/**
    Class: O.EventSource

    Extends: O.Object

    Subscribe to push events on the server using this wrapper around the W3C
    EventSource object: <http://dev.w3.org/html5/eventsource/>

    Events are sent using a text/event-stream content type; see the linked spec
    for details. The event source object will fire events as they arrive.
*/
var EventSource = NativeEventSource ? NS.Class({

    Extends: NS.Object,

    /**
        Property: O.EventSource#readyState
        Type: Number

        A number describing the ready state of the event source, corresponding
        to those in the W3C spec:

        0 - CONNECTING
        1 - OPEN
        2 - CLOSED
    */

    /**
        Property: O.EventSource#url
        Type: String

        The url to connect to in order to receive events
    */
    url: '',

    /**
        Constructor: O.EventSource

        Parameters:
            mixin - {Object} (optional) Any properties in this object will be
                    added to the new O.EventSource instance before
                    initialisation (so you can pass it getter/setter functions
                    or observing methods).
    */
    init: function ( mixin ) {
        this._then = 0;
        this._tick = null;

        this.readyState = CLOSED;

        EventSource.parent.init.call( this, mixin );

        var eventTypes = [ 'open', 'message', 'error' ],
            observers = NS.meta( this ).observers,
            type;
        for ( type in observers ) {
            if ( /^__event__/.test( type ) ) {
                eventTypes.include( type.slice( 9 ) );
            }
        }
        this._eventTypes = eventTypes;
    },

    on: function ( type ) {
        var types = this._eventTypes,
            eventSource = this._eventSource;
        if ( types.indexOf( type ) === -1 ) {
            types.push( type );
            if ( eventSource ) {
                eventSource.addEventListener( type, this, false );
            }
        }
        EventSource.parent.on.apply( this, arguments );
    },

    handleEvent: function ( event ) {
        this.set( 'readyState', this._eventSource.readyState );
        this.fire( event.type, event );
    }.invokeInRunLoop(),

    /**
        Method (private): O.EventSource#_check

        Checks the computer hasn't been asleep. If it has, it restarts the
        connection.
    */
    _check: function () {
        var now = Date.now();
        if ( now - this._then > 67500 ) {
            this.fire( 'restart' )
                .close()
                .open();
        } else {
            this._then = now;
            this._tick =
                NS.RunLoop.invokeAfterDelay( this._check, 60000, this );
            // Chrome occasionally closes the event source without firing an
            // event. Resync readyState here to work around.
            this.set( 'readyState', this._eventSource.readyState );
        }
    },
    /**
        Method (private): O.EventSource#_startStopCheck

        Sets up the timer to check if the computer has been asleep.
    */
    _startStopCheck: function () {
        var tick = this._tick;
        if ( this.get( 'readyState' ) !== CLOSED ) {
            if ( !tick ) {
                this._then = Date.now();
                this._check();
            }
        } else {
            if ( tick ) {
                NS.RunLoop.cancel( tick );
                this._tick = null;
            }
        }
    }.observes( 'readyState' ),

    /**
        Method: O.EventSource#open

        If there is no current connection to the event source server,
        establishes a new connection.

        Returns:
            {O.EventSource} Returns self.
    */
    open: function () {
        if ( this.get( 'readyState' ) === CLOSED ) {
            var eventSource = this._eventSource =
                new NativeEventSource( this.get( 'url' ) );

            this._eventTypes.forEach( function ( type ) {
                eventSource.addEventListener( type, this, false );
            }, this );

            this.set( 'readyState', eventSource.readyState );
        }
        return this;
    },

    /**
        Method: O.EventSource#close

        Close the connection to the event source server, if not already closed.

        Returns:
            {O.EventSource} Returns self.
    */
    close: function () {
        return this.set( 'readyState', CLOSED );
    },

    /**
        Method (private): O.EventSource#_sourceDidClose

        Removes event listeners and then the reference to an event source after
        it closes, as they cannot be reused.
    */
    _sourceDidClose: function () {
        if ( this.get( 'readyState' ) === CLOSED ) {
            var eventSource = this._eventSource,
                types = this._eventTypes,
                l = types.length;
            eventSource.close();
            while ( l-- ) {
                eventSource.removeEventListener( types[l], this, false );
            }
            this._eventSource = null;
        }
    }.observes( 'readyState' )
}) : NS.Class({

    Extends: NS.Object,

    readyState: CONNECTING,

    init: function ( mixin ) {
        EventSource.parent.init.call( this, mixin );
        this._xhr = new NS.XHR( this );
    },

    open: function () {
        var headers = {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
        };
        if ( this._lastEventId ) {
            headers[ 'Last-Event-ID' ] = this._lastEventId;
        }
        if ( this._poll ) {
            headers[ 'X-Nginx-PushStream-Mode' ] = 'long-polling';
        }

        this.set( 'readyState', CONNECTING );
        this._data = '';
        this._eventName = '';
        this._processedIndex = 0;
        this._lastNewLineIndex = 0;
        this._xhr.send( 'GET', this.get( 'url' ), null, headers );
        return this;
    },

    close: function () {
        if ( this.get( 'readyState' ) !== CLOSED ) {
            this._xhr.abort();
            this.set( 'readyState', CLOSED );
        }
        return this;
    },

    _reconnectAfter: 30000,
    _lastEventId: '',

    // ---

    // IE8 & IE9 can only read response text when readyState == 4.
    // http://msdn.microsoft.com/en-us/library/ie/hh673569(v=vs.85).aspx
    _poll: !!NS.UA.msie && NS.UA.msie < 10,

    _dataDidArrive: function () {
        var xhr = this._xhr;
        // Must start with text/event-stream (i.e. indexOf must === 0)
        // If it doesn't, fail the connection.
        // IE doesn't let you read headers in the loading phase, so if we don't
        // know the response type, we'll just presume it's correct.
        var responseType = xhr.getResponseType();
        if ( responseType && responseType.indexOf( 'text/event-stream' ) ) {
            this._failConnection();
        } else {
            this._openConnection();
            this._processData( xhr.getResponse() );
        }
    }.on( 'io:loading' ),

    _requestDidSucceed: function ( event ) {
        this._openConnection();
        this._processData( event.data + '\n\n' );
        this._reconnect();
    }.on( 'io:success' ),

    _requestDidFail: function () {
        this._failConnection();
    }.on( 'io:failure' ),

    // ---

    _openConnection: function () {
        if ( this.get( 'readyState' ) === CONNECTING ) {
            this.set( 'readyState', OPEN )
                .fire( 'open' );
        }
    },

    _failConnection: function () {
        this.close()
            .fire( 'error' );
    },

    _reconnect: function () {
        if ( this._poll ) {
            this.open();
        } else {
            NS.RunLoop.invokeAfterDelay(
                this.open, this._reconnectAfter, this );
        }
    },

    _processData: function ( text ) {
        // Look for a new line character since the last processed
        var lastIndex = this._lastNewLineIndex,
            newLine = /\u000d\u000a?|\u000a/g,
            match;

        // One leading U+FEFF BYTE ORDER MARK character must be ignored if any
        // are present.
        if ( !lastIndex && text.charAt( 0 ) === '\ufeff' ) {
            lastIndex = 1;
        }
        newLine.lastIndex = this._processedIndex;
        while ( match = newLine.exec( text ) ) {
            this._processLine( text.slice( lastIndex, match.index ) );
            lastIndex = newLine.lastIndex;
        }
        this._lastNewLineIndex = lastIndex;
        this._processedIndex = text.length;
    },

    _processLine: function ( line ) {
        // Blank line, dispatch event
        if ( /^\s*$/.test( line ) ) {
            this._dispatchEvent();
        } else {
            var colon = line.indexOf( ':' ),
                field = line,
                value = '';
            // Line starts with colon -> ignore.
            if ( !colon ) {
                return;
            }
            // Line contains colon:
            if ( colon > 0 ) {
                field = line.slice( 0, colon );
                value = line.slice( line.charAt( colon + 1 ) === ' ' ?
                    colon + 2 : colon + 1 );
            }
            switch ( field ) {
                case 'event':
                    this._eventName = value;
                    break;
                case 'data':
                    this._data += value + '\u000a';
                    break;
                case 'id':
                    this._lastEventId = value;
                    break;
                case 'retry':
                    if ( /^\d+$/.test( value ) ) {
                        this._reconnectAfter = parseInt( value, 10 );
                    }
                    break;
            }
        }
    },

    _dispatchEvent: function () {
        var data = this._data,
            type = this._eventName;
        if ( data ) {
            if ( data.slice( -1 ) === '\u000a' ) {
                data = data.slice( 0, -1 );
            }
            this.fire( type || 'message', {
                data: data,
                // origin: '',
                lastEventId: this._lastEventId
            });
        }
        this._data = '';
        this._eventName = '';
    }
});

/**
    Constant: O.EventSource.CONNECTING
    Type: Number

    <O.EventSource#readyState> when establishing a connection to the server.
*/
/**
    Constant: O.EventSource.OPEN
    Type: Number

    <O.EventSource#readyState> when a connection is open and receiving events.
*/
/**
    Constant: O.EventSource.CLOSED
    Type: Number

    <O.EventSource#readyState> when there is no connection and it is not being
    reestablished.
*/
EventSource.extend({
    CONNECTING: CONNECTING,
    OPEN: OPEN,
    CLOSED: CLOSED
});

NS.EventSource = EventSource;

}( O, typeof EventSource !== 'undefined' ? EventSource : null ) );


// -------------------------------------------------------------------------- \\
// File: FormUploader.js                                                      \\
// Module: IO                                                                 \\
// Requires: Core, Foundation, XHR.js                                         \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global window, document */

( function ( NS ) {

var hidden = {
    position: 'absolute',
    top: -1000,
    left: -1000
};

/**
    Class: O.FormUploader

    A class suitable for uploading FormData objects. The concrete class may be
    <O.XHR> if it supports the XMLHttpRequest Level 2 spec, or
    <O.FormUploader-IFrameTransport> if not. Either way, the interface is
    identical so you can ignore the underlying implementation.
*/
/**
    Constructor: O.FormUploader

    Parameters:
        io - {Object} An object containing any combination of the methods
             'uploadProgress', 'loading', 'success' and 'failure', to be called
             by the FormUploader instance as these events occur.
*/

/**
    Class: O.FormUploader-IFrameTransport

    An IO-compatible class that submits form data to a hidden iframe, allowing
    background file uploading.
*/
NS.FormUploader = window.FormData ? NS.XHR : NS.Class({
    /**
        Property: O.FormUploader-IFrameTransport#io
        Type: Object

        Reference to object on which callbacks are made.
    */
    io: null,

    /**
        Constructor: O.FormUploader-IFrameTransport

        Parameters:
            io - {Object} An object containing any combination of the methods
                 'uploadProgress', 'loading', 'success' and 'failure', to be
                 called by the FormUploader instance as these events occur.
    */
    init: function ( io ) {
        this._isSuccess = false;
        this._isRunning = false;
        this._response = '';
        this.io = io || null;
    },

    /**
        Property (private): O.FormUploader-IFrameTransport#_isSuccess
        Type: Boolean

        Was the request successful?
    */

    /**
        Property (private): O.FormUploader-IFrameTransport#_isRunning
        Type: Boolean

        Is there a request in progress?
    */

    /**
        Method: O.FormUploader-IFrameTransport#isRunning

        Determines whether a request is currently in progress.

        Returns:
            {Boolean} Is there a request in progress?
    */
    isRunning: function () {
        return this._isRunning;
    },

    /**
        Property (private): O.FormUploader-IFrameTransport#_response
        Type: String

        The response text.
    */

    /**
        Method: O.FormUploader-IFrameTransport#getResponse
            Get the response to the request.

        Returns:
            {String} The full text of the response to the request.
    */
    getResponse: function () {
        return this._response;
    },

    /**
        Method: O.FormUploader-IFrameTransport#getResponseType

        Returns:
            {String} Always "application/json".
    */
    getResponseType: function () {
        return 'application/json';
    },

    /**
        Method: O.FormUploader-IFrameTransport#getStatus

        Returns the HTTP status code representing the status of the request.

        Returns:
            {Number} The HTTP status code.
    */
    getStatus: function () {
        return this._isRunning ? 0 : this._isSuccess ? 200 : 400;
    },

    /**
        Method: O.FormUploader-IFrameTransport#send

        If a request is currently active, it is first aborted. A new request is
        then made to the server, using the parameters supplied.

        Parameters:
            method - {String} This is ignored; the method is always POST.
            url    - {String} The URL to which the request is to be made.
            data   - {FormData} The data to send in the body of the request.

        Returns:
            {O.FormUploader-IFrameTransport} Returns self.
    */
    send: function ( method, url, data ) {
        if ( !( data instanceof window.FormData ) ) {
            throw new Error( 'IFrameTransport only sends FormData objects' );
        }
        if ( this._isRunning ) {
            this.abort();
        }

        this._isRunning = true;
        this._isSuccess = false;
        this._response = '';

        var that = this,
            body = document.body,
            transactionId = this._transactionId = 'upload' + Date.now(),
            frameName = 'frame-' + transactionId,
            iframe = this._iframe = NS.Element.create( 'iframe', {
                id: frameName,
                name: frameName,
                styles: hidden
            }),
            form = this._form = data.form;

        url += ( url.contains( '?' ) ? '&' : '?' ) +
            'callback=top.' + transactionId;
        form.action = this._targetUrl = url;
        form.target = frameName;

        iframe.addEventListener( 'load', this._loadfn = function () {
            that._formFrameDidLoad();
        }, false );

        window[ transactionId ] = function ( data ) {
            var status = 200,
                responseType = 'application/json',
                response = JSON.stringify( data ),
                io = that.io;
            that._response = response;
            that._isSuccess = true;
            if ( io ) {
                io.set( 'uploadProgress', 100 )
                  .set( 'progress', 100 )
                  .set( 'status', status )
                  .set( 'responseType', responseType )
                  .set( 'response', response )
                  .fire( 'io:success', {
                    status: status,
                    headers: {},
                    type: responseType,
                    data: response
                  })
                  .fire( 'io:end' );
            }
        }.invokeInRunLoop();

        body.appendChild( iframe );
        body.appendChild( form );
        form.submit();

        return this;
    },

    /**
        Method (private): O.FormUploader-IFrameTransport#_formFrameDidLoad

        Callback for when the iframe to which the form was submitted has loaded.
    */
    _formFrameDidLoad: function () {
        // First load event is fired as soon as the frame is appended to the
        // DOM. Ignore this one; we're only interested in what happens after the
        // full page has loaded.
        var iframeHref, io;
        // May throw a security error in old IE/Opera.
        try  {
            iframeHref = this._iframe.contentWindow.location.href;
        } catch ( error ) {}
        if ( iframeHref === 'about:blank' ) {
            return;
        }
        this._isRunning = false;
        if ( !this._isSuccess ) {
            io = this.io;
            io.set( 'uploadProgress', 100 )
               .set( 'progress', 100 )
               .set( 'status', 400 )
               .fire( 'io:failure', {
                 status: 400,
                 headers: {},
                 type: '',
                 data: ''
               })
               .fire( 'io:end' );
        }
        this._complete();
    }.invokeInRunLoop(),

    /**
        Method: O.FormUploader-IFrameTransport#abort

        Aborts the currently active request. No further callbacks will be made
        for that request. If there is no active request, calling this method has
        no effect.

        Returns:
            {O.FormUploader-IFrameTransport} Returns self.
    */
    abort: function () {
        if ( this._isRunning ) {
            this._isRunning = false;
            this._complete();
            this.io
                .fire( 'io:abort' )
                .fire( 'io:end' );
        }
        return this;
    },

    /**
        Method (private): O.FormUploader-IFrameTransport#_complete

        Removes event listeners and releases references to objects associated
        with the request.
    */
    _complete: function () {
        var body = document.body;
        body.removeChild( this._form );
        body.removeChild( this._iframe );
        this._iframe.removeEventListener( 'load', this._loadfn, false );
        window[ this._transactionId ] = null;
        this._iframe = this._form = this._loadfn = null;
    }
});

/**
    Class: FormData

    Implementation of the FormData object for browsers that don't natively
    support it. Slightly different from spec in that you can call append() with
    a form element as the value; this is to support browsers that do not
    implement the File API and therefore cannot supply a File object as the
    value.
*/
if ( !window.FormData ) {
    window.FormData = NS.Class({
        init: function () {
            this.form = NS.Element.create( 'form', {
                method: 'post',
                enctype: 'multipart/form-data',
                styles: hidden
            });
        },
        append: function ( name, value ) {
            if ( typeof value === 'string' ) {
                this.form.appendChild( NS.Element.create( 'input', {
                    type: 'hidden',
                    name: name,
                    value: value
                }) );
            } else {
                var file = value.file;
                if ( file.nodeType ) {
                    file.name = name;
                    this.form.appendChild( file );
                }
            }
        }
    });
    window.FormData.isFake = true;
}

}( O ) );


// -------------------------------------------------------------------------- \\
// File: HttpRequest.js                                                       \\
// Module: IO                                                                 \\
// Requires: Core, Foundation, XHR.js                                         \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global location */

( function ( NS ) {

var xhrPool = [];
var getXhr = function () {
    return xhrPool.pop() || new NS.XHR();
};
var releaseXhr = function ( xhr ) {
    xhrPool.push( xhr );
};

/**
    Class: O.HttpRequest

    Extends: O.Object

    The O.HttpRequest class represents an HTTP request. It will automatically
    choose between an XHR and an iframe form submission for uploading form data,
    depending on browser support.
*/

var HttpRequest = NS.Class({

    Extends: NS.Object,

    /**
        Property: O.HttpRequest#timeout
        Type: Number
        Default: 0

        Time in milliseconds to wait before timing out and aborting the request.
        If the value is 0, the request will not timeout but will wait
        indefinitely to complete.
    */
    timeout: 0,

    /**
        Property: O.HttpRequest#method
        Type: String
        Default: 'GET'

        The HTTP method to use for the request.
    */
    method: 'GET',

    /**
        Property: O.HttpRequest#url
        Type: String
        Default: The current location path (i.e. the URL before the ? or #).

        The URL to submit the request to.
    */
    url: location.pathname,

    /**
        Property: O.HttpRequest#contentType
        Type: String
        Default: 'application/x-www-form-urlencoded'

        The Content-type header for POST requests.
    */
    contentType: 'application/x-www-form-urlencoded',

    /**
        Property: O.HttpRequest#headers
        Type: Object
        Default:
                {Accept: 'application/json, * / *'}

        An object of default headers to be sent with each request (can be
        overriden individually in each request). The format of the object is
        `{headerName: headerValue}`.
    */
    headers: {
        'Accept': 'application/json, */*'
    },

    // ---

    init: function ( mixin ) {
        this._transport = null;
        this._timer = null;
        this._lastActivity = 0;

        this.uploadProgress = 0;
        this.progress = 0;

        this.status = 0;
        this.responseType = '';
        this.responseHeaders = {};
        this.response = '';

        HttpRequest.parent.init.call( this, mixin );
    },

    // ---

    setTimeout: function () {
        var timeout = this.get( 'timeout' );
        if ( timeout ) {
            this._lastActivity = Date.now();
            this._timer = NS.RunLoop.invokeAfterDelay(
                this.didTimeout, timeout, this );
        }
    }.on( 'io:begin' ),

    resetTimeout: function () {
        this._lastActivity = Date.now();
    }.on( 'io:uploadProgress', 'io:loading', 'io:progress' ),

    clearTimeout: function () {
        var timer = this._timer;
        if ( timer ) {
            NS.RunLoop.cancel( timer );
        }
    }.on( 'io:end' ),

    didTimeout: function () {
        this._timer = null;
        var timeout = this.get( 'timeout' ),
            timeSinceLastReset = Date.now() - this._lastActivity,
            timeToTimeout = timeout - timeSinceLastReset;
        // Allow for 10ms jitter
        if ( timeToTimeout < 10 ) {
            this.fire( 'io:timeout' )
                .abort();
        } else {
            this._timer = NS.RunLoop.invokeAfterDelay(
                this.didTimeout, timeToTimeout, this );
        }
    },

    // ---

    send: function () {
        var method = this.get( 'method' ).toUpperCase(),
            url = this.get( 'url' ),
            data = this.get( 'data' ) || null,
            headers = this.get( 'headers' ),
            transport =
                ( data instanceof FormData && NS.FormUploader !== NS.XHR ) ?
                    new NS.FormUploader() : getXhr(),
            contentType;

        if ( data && method === 'GET' ) {
            url += ( url.contains( '?' ) ? '&' : '?' ) + data;
            data = null;
        }
        contentType = headers[ 'Content-type' ];
        if ( contentType && method === 'POST' && typeof data === 'string' &&
                contentType.indexOf( ';' ) === -1 ) {
            // All string data is sent as UTF-8 by the browser.
            // This cannot be altered.
            headers[ 'Content-type' ] += ';charset=utf-8';
        }

        // Send the request
        this._transport = transport;
        transport.io = this;
        transport.send( method, url, data, headers );

        return this;
    },

    abort: function () {
        var transport = this._transport;
        if ( transport && transport.io === this ) {
            transport.abort();
        }
    },

    _releaseXhr: function () {
        var transport = this._transport;
        if ( transport instanceof NS.XHR ) {
            releaseXhr( transport );
            transport.io = null;
            this._transport = null;
        }
    }.on( 'io:success', 'io:failure', 'io:abort' )

    // ---

    /**
        Event: io:begin

        This event is fired when the request starts.
     */

    /**
        Event: io:abort

        This event is fired if the request is aborted.
    */

    /**
        Event: io:uploadProgress

        This event *may* be fired as data is uploaded, but only if the browser
        supports XHR2.
    */

    /**
        Event: io:loading

        This event is fired when the response body begins to download.
    */

    /**
        Event: io:progress

        This event *may* be fired periodically whilst the response body is
        downloading, but only if the browser supports XHR2.
    */

    /**
        Event: io:success

        This event is fired if the request completes successfully. It includes
        the following properties:

        status  - The HTTP status code of the response.
        headers - The headers of the response.
        type    - The MIME type of the response.
        data    - The data returned by the response.
    */

    /**
        Event: io:failure

        This event is fired if the request completes unsuccessfully (normally
        determined by the HTTP status code). It includes the following
        properties:

        status  - The HTTP status code of the response.
        headers - The headers of the response.
        type    - The MIME type of the response.
        data    - The data returned by the response.
    */

    /**
        Event: io:timeout

        This event is fired if the request times out.
    */

    /**
        Event: io:end

        This is the final event to be fired for the request, this will always
        fire no matter if the request was successful, failed or aborted.
    */
});

NS.HttpRequest = HttpRequest;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: IOQueue.js                                                           \\
// Module: IO                                                                 \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/**
    Module: IO

    The IO module provides classes for two-way communication with a server.
*/

( function ( NS ) {

/**
    Class: O.IOQueue

    Extends: O.Object

    Manage concurrent HTTP requests.
*/

var QUEUE = 1,
    IGNORE = 2,
    ABORT = 3;

var IOQueue = NS.Class({

    Extends: NS.Object,

    /**
        Property (private): O.IOQueue#_queue
        Type: Array

        Queue of request objects waiting for current transactions to finish.
    */

    /**
        Property: O.IOQueue#_recent
        Type: (O.HttpRequest|null)

        A reference to the most recent request.
    */

    /**
        Property: O.IOQueue#activeConnections
        Type: Number

        The number of active connections
    */

    /**
        Property: O.IOQueue#link
        Type: Number
        Default: O.IOQueue.QUEUE

        The property is used to determine what to do if a request is made and
        there are already the maximum allowed number of connections. Accepted
        values are the constants IOQueue.QUEUE, IOQueue.IGNORE and
        IOQueue.ABORT.

        * QUEUE: adds the request to a queue and then waits for the next active
          connection to finish before dispatching the oldest waiting request
          and so on until the queue is empty.
        * IGNORE: ignores the request if there are no free connections.
        * ABORT: aborts the most recent active request and immediately
          dispatches the new request.
    */
    link: QUEUE,

    /**
        Property: O.IOQueue#maxConnections
        Type: Number
        Default: 1

        The maximum number of concurrent connections to make with this IOQueue
        object. Note, this is a per-instance value; each IOQueue instance may
        make up to maxConnections to the server as defined on that object.
    */
    maxConnections: 1,

    /**
        Constructor: O.IOQueue

        Parameters:
            mixin - {Object} An object containing new defaults for any of the
                    public properties defined on the object. Can also contain
                    methods to override the normal methods to create an
                    anonymous subclass.
    */
    init: function ( mixin ) {
        this._queue = [];
        this._recent = null;
        this.activeConnections = 0;

        IOQueue.parent.init.call( this, mixin );
    },

    /**
        Method: O.IOQueue#send

        If the number of active requests is equal to the maximum allowed number
        of concurrent connections, the request will be queued, ignored or cause
        the most recent active request to abort as specified in the
        <O.IOQueue#link> property.

        Parameters:
            request - {O.HttpRequest}

        Returns:
            {O.IOQueue} Returns self.
    */
    send: function ( request ) {
        if ( this.get( 'activeConnections' ) >= this.get( 'maxConnections' ) ) {
            switch ( this.get( 'link' ) ) {
                case QUEUE:
                    this._queue.push( request );
                    /* falls through */
                case IGNORE:
                    return this;
                case ABORT:
                    this._recent.abort();
                    break;
                default:
                    throw new Error( 'Invalid O.IOQueue link type.' );
            }
        }

        this.increment( 'activeConnections', 1 );

        // If already set, presume it will bubble to us
        if ( !request.get( 'nextEventTarget' ) ) {
            request.set( 'nextEventTarget', this );
        }

        // Store reference in case we need to abort a request.
        this._recent = request.send();

        return this;
    },

    /**
        Method: O.IOQueue#abort

        Abort the request if it is currently running, or remove it from the
        waiting queue if it has not yet run.

        Parameters:
            request - {O.HttpRequest}

        Returns:
            {O.IOQueue} Returns self.
    */
    abort: function ( request ) {
        this._queue.erase( request );
        request.abort();
        return this;
    },

    /**
        Method (private): O.IOQueue#_complete

        Cleans up any state set by the IOQueue methods on the Transport object
        and starts the next request in the queue, if any.

        Parameters:
            transport - {Transport} The transport object.
    */
    _complete: function ( event ) {
        var request = event.target;
        if ( this._recent === request ) {
            this._recent = null;
        }
        if ( request.get( 'nextEventTarget' ) === this ) {
            request.set( 'nextEventTarget', null );
        }
        this.increment( 'activeConnections', -1 );

        if ( this._queue.length ) {
            this.send( this._queue.shift() );
        }
    }.on( 'io:end' )
});

IOQueue.QUEUE = 1;
IOQueue.IGNORE = 2;
IOQueue.ABORT = 3;

NS.IOQueue = IOQueue;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Locale.js                                                            \\
// Module: Localisation                                                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var compileTranslation = function ( translation ) {
    var compiled = '',
        start = 0,
        searchIndex = 0,
        length = translation.length,
        end, parts, part, partLength,
        i, j, l;

    outer: while ( true ) {
        end = translation.indexOf( '[', searchIndex ) ;
        // If there are no more macros, just the last text section to
        // process.
        if ( end === -1 ) {
            end = length;
        } else {
            // Check the '[' isn't escaped (preceded by an odd number of
            // '~' characters):
            j = end;
            while ( j-- ) {
                if ( translation[ j ] !== '~' ) {
                    break;
                }
            }
            if ( ( end - j ) % 2 === 0 ) {
                searchIndex = end + 1;
                continue;
            }
        }
        // Standard text section
        part = translation.slice( start, end ).replace( /~(.)/g, '$1' );
        if ( part ) {
            if ( compiled ) { compiled += '+'; }
            compiled += '"';
            compiled += part.replace( /\\/g, '\\' )
                            .replace( /"/g, '\\"' );
            compiled += '"';
        }
        // Check if we've reached the end of the string
        if ( end === length ) { break; }
        // Macro section
        start = searchIndex = end + 1;
        // Find the end of the macro call.
        while ( true ) {
            end = translation.indexOf( ']', searchIndex );
            // Invalid translation string.
            if ( end === -1 ) {
                compiled = '';
                break outer;
            }
            // Check the ']' character isn't escaped.
            j = end;
            while ( j-- ) {
                if ( translation[ j ] !== '~' ) {
                    break;
                }
            }
            if ( ( end - j ) % 2 ) {
                break;
            }
            searchIndex = end + 1;
        }
        // Split into parts
        parts = translation.slice( start, end ).split( ',' );
        l = parts.length;

        if ( compiled ) {
            compiled += '+';
        }
        if ( l > 1 ) {
            compiled += 'lang.macros["';
        }
        for ( i = 0; i < l; i += 1 ) {
            // If not the first part, add a comma to separate the
            // arguments to the macro function call.
            if ( i > 1 ) {
                compiled += ',';
            }
            // If a comma was escaped, we split up an argument.
            // Rejoin these.
            part = parts[i];
            partLength = part.length;
            while ( partLength && part[ partLength - 1 ] === '~' ) {
                i += 1;
                part += ',';
                part += parts[i];
                partLength = part.length;
            }
            // Unescape the part.
            part = part.replace( /~(.)/g, '$1' );
            // Check if we've got an argument.
            if ( /^_(?:\*|\d+)$/.test( part ) ) {
                part = part.slice( 1 );
                compiled += 'args';
                compiled += ( part === '*' ?
                    '' : '[' + ( parseInt( part, 10 ) - 1 ) + ']'
                );
            }
            // Otherwise:
            else {
                // First part is the macro name.
                if ( !i ) {
                    compiled += ( part === '*' ?
                        'quant' : part === '#' ? 'numf' : part );
                    compiled += '"].call(lang,';
                }
                // Anything else is a plain string argument
                else {
                    compiled += '"';
                    compiled += part.replace( /\\/g, '\\' )
                                    .replace( /"/g, '\\"' );
                    compiled += '"';
                }
            }
        }
        if ( l > 1 ) {
            compiled += ')';
        }
        start = searchIndex = end + 1;
    }

    /*jshint evil: true */
    return new Function( 'lang', 'args',
    /*jshint evil: false */
        'return ' + ( compiled || '""' ) + ';'
    );
};

var formatInt = function ( number, locale ) {
    var string = number + '';
    if ( string.length > 3 ) {
        string = string.replace(
            /(\d+?)(?=(?:\d{3})+$)/g,
            '$1' + locale.thousandsSeparator
        );
    }
    return string;
};

/**
    Class: O.Locale

    Locale packs for use in localisation are created as instances of the
    O.Locale class.
*/
var Locale = NS.Class({

    /**
        Constructor: O.Locale

        Most options passed as the argument to this constructor are just added
        as properties to the object (and will override any inherited value for
        the same key). The following keys are special:

        code         - {String} The code for this locale. This *must* be
                       included.
        macros       - {Object} A mapping of key to functions, which may be used
                       inside the string translations (see documentation for the
                       translate method).
        translations - {Object} A mapping of key to string or function
                       specifying specific translations for this locale.
        dateFormats  - {Object} A mapping of key to (String|Date->String), each
                       taking a single Date object as an argument and outputing
                       a formatted date.

        Parameters:
            mixin - {Object} Information for this locale.
    */
    init: function ( mixin ) {
        [ 'macros', 'dateFormats' ].forEach( function ( obj ) {
            this[ obj ] = Object.create( this[ obj ] );
        }, this );
        this.compiled = {};
        NS.merge( this, mixin );
    },

    /**
        Property: O.Locale#code
        Type: String

        The ISO code for this locale.
    */
    code: 'xx',

    // === Numbers ===

    /**
        Property: O.Locale#decimalPoint
        Type: String

        The symbol used to divide the integer part from the decimal part of a
        number.
    */
    decimalPoint: '.',

    /**
        Property: O.Locale#thousandsSeparator
        Type: String

        The symbol used to divide large numbers up to make them easier to read.
    */
    thousandsSeparator: ',',

    /**
        Property: O.Locale#fileSizeUnits
        Type: String[]

        An array containing the suffix denoting units of bytes, kilobytes,
        megabytes and gigabytes (in that order).
    */
    fileSizeUnits: [ 'B', 'KB', 'MB', 'GB' ],

    /**
        Method: O.Locale#getFormattedNumber

        Format a number according to local conventions. Ensures the correct
        symbol is used for a decimal point, and inserts thousands separators if
        used in the locale.

        Parameters:
            number - {(Number|String)} The number to format.

        Returns:
            {String} The localised number.
    */
    getFormattedNumber: function ( number ) {
        var integer = number + '',
            fraction = '',
            decimalPointIndex = integer.indexOf( '.' );
        if ( decimalPointIndex > -1 ) {
            fraction = integer.slice( decimalPointIndex + 1 );
            integer = integer.slice( 0, decimalPointIndex );
        }
        return formatInt( integer, this ) +
            ( fraction && this.decimalPoint + fraction );
    },

    /**
        Method: O.Locale#getFormattedOrdinal

        Format an ordinal number according to local conventions, e.g. "1st",
        "42nd" or "53rd".

        Parameters:
            number - {Number} The number to format.

        Returns:
            {String} The localised ordinal.
    */
    getFormattedOrdinal: function ( number ) {
        return number + '.';
    },

    /**
        Method: O.Locale#getFormattedFileSize

        Format a number of bytes into a locale-specific file size string.

        Parameters:
            bytes         - {Number} The number of bytes.
            decimalPlaces - {Number} (optional) The number of decimal places to
                            use in the result, if in MB or GB.

        Returns:
            {String} The localised, human-readable file size.
    */
    getFormattedFileSize: function ( bytes, decimalPlaces ) {
        var units = this.fileSizeUnits,
            l = units.length - 1,
            i = 0,
            ORDER_MAGNITUDE = 1000,
            number;
        while ( i < l && bytes >= ORDER_MAGNITUDE ) {
            bytes /= ORDER_MAGNITUDE;
            i += 1;
        }
        // B/KB to nearest whole number, MB/GB to 1 decimal place.
        number = ( i < 2 ) ?
            Math.round( bytes ) + '' :
            bytes.toFixed( decimalPlaces || 0 );
        // Use a &nbsp; to join the number to the unit.
        return this.getFormattedNumber( number ) + ' ' + units[i];
    },

    // === Date and Time ===

    /**
        Property: O.Locale#dayNames
        Type: String[]

        Names of days of the week, starting from Sunday at index 0.
    */
    dayNames: [ 'Sunday', 'Monday', 'Tuesday',
        'Wednesday', 'Thursday', 'Friday', 'Saturday' ],
    /**
        Property: O.Locale#abbreviatedDayNames
        Type: String[]

        Abbeviated names of days of the week, starting from Sunday at index 0.
    */
    abbreviatedDayNames: [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ],

    /**
        Property: O.Locale#monthNames
        Type: String[]

        Names of months of the year, starting from January.
    */
    monthNames: [ 'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December' ],

    /**
        Property: O.Locale#abbreviatedMonthNames
        Type: String[]

        Abbeviated names of months of the year, starting from January.
    */
    abbreviatedMonthNames: [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ],

    /**
        Property: O.Locale#amDesignator
        Type: String

        The string used to designate AM. Will be the empty string in locales
        which do not use the 12h clock.
    */
    amDesignator: 'AM',

    /**
        Property: O.Locale#amDesignator
        Type: String

        The string used to designate PM. Will be the empty string in locales
        which do not use the 12h clock.
    */
    pmDesignator: 'PM',

    /**
        Property: O.Locale#use24hClock
        Type: Boolean

        Should the 24h clock be used?
    */
    use24hClock: true,

    /**
        Property: O.Locale#dateElementOrde
        Type: String

        Either 'dmy', 'mdy' or 'ymd', representing the order of day/month/year
        used in this locale to write dates.
    */
    dateElementOrder: 'dmy',

    /**
        Property: O.Locale#dateFormats
        Type: String[String]

        A set of string patterns for dates, in the format used with
        <Date#format>.
    */
    dateFormats: {
        date: '%d/%m/%Y',
        time: function ( date, locale, utc ) {
            return date.format(
                locale.use24hClock ? this.time24 : this.time12, utc );
        },
        time12: '%-I:%M %p',
        time24: '%H:%M',
        fullDate: '%A, %-d %B %Y',
        fullDateAndTime: '%A, %-d %B %Y %H:%M',
        abbreviatedFullDate: '%a, %-d %b %Y',
        shortDayMonth: '%-d %b',
        shortDayMonthYear: '%-d %b ’%y'
    },

    /**
        Property: O.Locale#datePatterns
        Type: String[RegExp]

        A set of regular expresions for matching key words used in dates.
    */
    datePatterns: {},

    /**
        Method: O.Locale#getFormattedDate

        Get a date or time formatted according to local conventions.

        Parameters:
            date - {Date} The date object to format.
            type - {String} The type of result you want, e.g. 'shortDate',
                   'time', 'fullDateAndTime'.
            utc  - {Boolean} (optional) If true, the UTC time of this date
                   object will be used when determining the date.

        Returns:
            {String} The localised date.
    */
    getFormattedDate: function ( date, type, utc ) {
        var dateFormats = this.dateFormats,
            format = dateFormats[ type ] || dateFormats.date;
        return format instanceof Function ?
            dateFormats[ type ]( date, this, utc ) : date.format( format, utc );
    },

    // === Strings ===

    /**
        Property: O.Locale#macros
        Type: String[Function]

        The set of named macros that may be used in translations using the
        square brackets notation.
    */
    macros: {
        // Japanese, Vietnamese, Korean.
        // Case 1: everything.
        // Case 2: is 0 (optional; case 1 used if not supplied).
        '*1': function ( n, singular, zero ) {
            return ( !n && zero !== undefined ? zero : singular
            ).replace( '%n', formatInt( n, this ) );
        },
        // Most Western languages.
        // Case 1: is 1.
        // Case 2: everything else.
        // Case 3: is 0 (optional; plural used if not supplied).
        '*2': function ( n, singular, plural, zero ) {
            return ( n === 1 ? singular :
                !n && zero !== undefined ? zero : plural
            ).replace( '%n', formatInt( n, this ) );
        },
        // French and Brazilian Portuguese.
        // Case 1: is 0 or 1.
        // Case 2: everything else.
        // Case 3: is 0 (optional; singular used if not supplied).
        '*2a': function ( n, singular, plural, zero ) {
            return ( n > 1 ? plural :
                !n && zero !== undefined ? zero : singular
            ).replace( '%n', formatInt( n, this ) );
        },
        // Hungarian
        // Case 1: is 0,*3,*6,*8,*20,*30,*60,*80,*00,*000000, *000000+.
        // Case 2: everything else
        //        (*1,*2,*4,*5,*7,*9,*10,*40,*50,*70,*90,*000,*0000,*00000).
        // Case 3: is 0 (optional; case 1 used if not supplied)
        '*2b': function ( n, form1, form2, zero ) {
            return ( !n ? zero !== undefined ? zero : form1 :
                ( /(?:[368]|20|30|60|80|[^0]00|0{6,})$/.test( n + '' ) ) ?
                form1 : form2
            ).replace( '%n', formatInt( n, this ) );
        },
        // Latvian.
        // Case 1: is 0.
        // Case 2: ends in 1, does not end in 11.
        // Case 3: everything else.
        '*3a': function ( n, zero, plural1, plural2 ) {
            return (
                !n ? zero :
                n % 10 === 1 && n % 100 !== 11 ? plural1 : plural2
            ).replace( '%n', formatInt( n, this ) );
        },
        // Romanian.
        // Case 1: is 1.
        // Case 2: is 0 or ends in 01-19.
        // Case 3: everything else.
        // Case 4: is 0 (optional; case 2 used if not supplied)
        '*3b': function ( n, singular, plural1, plural2, zero ) {
            var mod100 = n % 100;
            return (
                !n && zero !== undefined ? zero :
                n === 1 ? singular :
                !n || ( 1 <= mod100 && mod100 <= 19 ) ? plural1 : plural2
            ).replace( '%n', formatInt( n, this ) );
        },
        // Lithuanian.
        // Case 1: ends in 1, not 11.
        // Case 2: ends in 0 or ends in 10-20.
        // Case 3: everything else.
        // Case 4: is 0 (optional; case 2 used if not supplied)
        '*3c': function ( n, form1, form2, form3, zero ) {
            var mod10 = n % 10,
                mod100 = n % 100;
            return (
                !n && zero !== undefined ? zero :
                mod10 === 1 && mod100 !== 11 ? form1 :
                mod10 === 0 || ( 10 <= mod100 && mod100 <= 20 ) ? form2 : form3
            ).replace( '%n', formatInt( n, this ) );
        },
        // Russian, Ukrainian, Serbian, Croatian.
        // Case 1: ends in 1, does not end in 11.
        // Case 2: ends in 2-4, does not end in 12-14.
        // Case 3: everything else
        // Case 4: is 0 (optional; case 3 used if not supplied)
        '*3d': function ( n, form1, form2, form3, zero ) {
            var mod10 = n % 10,
                mod100 = n % 100;
            return (
                !n && zero !== undefined ? zero :
                mod10 === 1 && mod100 !== 11 ? form1 :
                2 <= mod10 && mod10 <= 4 && ( mod100 < 12 || mod100 > 14 ) ?
                form2 : form3
            ).replace( '%n', formatInt( n, this ) );
        },
        // Czech, Slovak.
        // Case 1: is 1.
        // Case 2: is 2-4.
        // Case 3: everything else.
        // Case 4: is 0 (optional; case 3 used if not supplied)
        '*3e': function ( n, singular, plural1, plural2, zero ) {
            return (
                !n && zero !== undefined ? zero :
                n === 1 ? singular :
                2 <= n && n <= 4 ? plural1 : plural2
            ).replace( '%n', formatInt( n, this ) );
        },
        // Polish.
        // Case 1: is 1.
        // Case 2: ends in 2-4, does not end in 12-14.
        // Case 3: everything else
        // Case 4: is 0 (optional; case 3 used if not supplied)
        '*3f': function ( n, singular, plural1, plural2, zero ) {
            var mod10 = n % 10,
                mod100 = n % 100;
            return (
                !n && zero !== undefined ? zero :
                n === 1 ? singular :
                2 <= mod10 && mod10 <= 4 && ( mod100 < 12 || mod100 > 14 ) ?
                plural1 : plural2
            ).replace( '%n', formatInt( n, this ) );
        },
        // Slovenian, Sorbian.
        // Case 1: ends in 01.
        // Case 2: ends in 02.
        // Case 3: ends in 03 or 04.
        // Case 4: everything else.
        // Case 5: is 0 (optional; case 4 used if not supplied)
        '*4a': function ( n, end01, end02, end03or04, plural, zero ) {
            var mod100 = n % 100;
            return (
                !n && zero !== undefined ? zero :
                mod100 === 1 ? end01 :
                mod100 === 2 ? end02 :
                mod100 === 3 || mod100 === 4 ? end03or04 : plural
            ).replace( '%n', formatInt( n, this ) );
        },
        // Scottish Gaelic.
        // Case 1: is 1 or 11.
        // Case 2: is 2 or 12.
        // Case 3: is 3-19.
        // Case 4: everything else.
        // Case 5: is 0 (optional; case 4 used if not supplied)
        '*4b': function ( n, form1, form2, form3, form4, zero ) {
            return (
                !n && zero !== undefined ? zero :
                n === 1 || n === 11 ? form1 :
                n === 2 || n === 12 ? form2 :
                3 <= n && n <= 19 ? form3 : form4
            ).replace( '%n', formatInt( n, this ) );
        },
        // Gaeilge (Irish).
        // Case 1: is 1.
        // Case 2: is 2.
        // Case 3: is 3-6.
        // Case 4: is 7-10.
        // Case 5: everything else.
        // Case 6: is 0 (optional; case 5 used if not supplied)
        '*5': function ( n, singular, doubular, form1, form2, form3, zero ) {
            return (
                !n && zero !== undefined ? zero :
                n === 1 ? singular :
                n === 2 ? doubular :
                3 <= n && n <= 6 ? form1 :
                7 <= n && n <= 10 ? form2 : form3
            ).replace( '%n', formatInt( n, this ) );
        },
        // Arabic.
        // Case 1: is 0.
        // Case 2: is 1.
        // Case 3: is 2.
        // Case 4: ends in 03-10.
        // Case 5: ends in 11-99.
        // Case 6: everything else.
        '*6': function ( n, zero, singular, doubular, pl1, pl2, pl3 ) {
            var mod100 = n % 100;
            return (
                !n ? zero :
                n === 1 ? singular :
                n === 2 ? doubular :
                3 <= mod100 && mod100 <= 10 ? pl1 :
                11 <= mod100 && mod100 <= 99 ? pl2 : pl3
            ).replace( '%n', formatInt( n, this ) );
        },

        // The following four are deprecated and will be removed.
        quant: function ( n, singular, plural, zero ) {
            return ( !n && zero !== undefined ) ? zero :
                   ( n === 1 ) ? '1 ' + singular :
                   ( n + ' ' ) + ( plural || ( singular + 's' ) );
        },
        numerate: function ( n, singular, plural ) {
            return n !== 1 ? plural || ( singular + 's' ) : singular;
        },
        numf: function ( n ) {
            var parts = ( n + '' ).split( '.' );
            parts[0] = parts[0].replace( /(\d+?)(?=(?:\d{3})+$)/g,
                '$1' + this.thousandsSeparator );
            return parts.join( this.decimalPoint );
        },
        sprintf: function ( string ) {
            return String.prototype.format.apply( string,
                Array.prototype.slice.call( arguments, 1 ) );
        }
    },

    /**
        Property: O.Locale#translations
        Type: String[String]

        A map from the string identifier or English string to the localised
        string.
    */
    translations: {},

    /**
        Method: O.Locale#translate

        Get a localised version of a string.

        This method will first look up the string given as its first argument in
        the translations object for this locale. If it finds a value it will use
        that, otherwise it will use the original supplied string.

        If futher arguments are given, these are interpolated into the string.
        There are two different ways this can happen:

        1. If all the arguments are strings or numbers:

           Square brackets may be used inside strings to call macros; the syntax
           is the same as for Perl's maketext module. A macro is called like
           this: `[name,_1,arg2,arg3]`. Arguments are passed as literal strings,
           except if it is _n, where n is an integer. In this case, the argument
           will be argument n supplied at runtime to the translation method. To
           include a literal comma or close square bracket, precede it by a
           tilde. Macros are defined in the macro object of the locale and will
           be called with the locale object as the `this` parameter.

           The source string can also use a square bracket notation to just
           insert an argument, e.g.

               O.loc( "The city of [_1] is in [_2]", "Melbourne", "Australia" )
               => "The city of Melbourne is in Australia".

           The rules for pluralisation vary between languages, so if you have
           numbers you need to interpolate, your source string should use the
           appropriate pluralisation macro for your language. e.g.

               O.loc( "[*2,_1,1 file was,%n files were,No files were] found in [_2]", 11, "Documents" );
               => "11 files were found in Documents"

        2. If at least one of the arguments is an object:

           You cannot use macros, only "[_n]" placeholders. The result will be
           an array of string parts and your arguments. This can be useful when
           working with views, for example:

               O.Element.appendChildren( layer, O.loc(
                   "Searching [_1] for [_2]",
                   new O.SelectView({
                       value: O.bind(...),
                       options: [
                           { text: O.loc( "Everything" ),
                             value: true },
                           { text: O.loc( "Documents" ),
                             value: false }
                       ]
                   }),
                   el( 'b', {
                       text: O.bind(...)
                   })
               ));

        Parameters:
            string   - {String} The string to localise.
            var_args - {...(String|Number|Object)} The arguments to interpolate.

        Returns:
            {(String|Array)} The localised string or array of localised parts.
    */
    translate: function ( string ) {
        var translation = this.translations[ string ],
            returnString = true,
            args = [],
            i, l, arg, compiled, parts;

        if ( translation === undefined ) {
            translation = string;
        }

        for ( i = 1, l = arguments.length; i < l; i += 1 ) {
            arg = arguments[i];
            if ( typeof arg === 'object' ) {
                returnString = false;
            }
            args[ i - 1 ] = arg;
        }

        if ( returnString ) {
            compiled = this.compiled[ string ] ||
                ( this.compiled[ string ] = compileTranslation( translation ) );
            return compiled( this, args );
        }

        parts = translation.split( /\[_(\d)\]/ );
        for ( i = 1, l = parts.length; i < l; i += 2 ) {
            parts[i] = args[ parts[i] - 1 ] || null;
        }
        return parts;
    }
});

NS.Locale = Locale;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: LocaleController.js                                                  \\
// Module: Localisation                                                       \\
// Requires: Core, Locale.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global Intl */

( function ( NS, undefined ) {

/**
    Module: Localisation

    The Localisation module provides classes for localising an interface.
*/

/**
    Class: O.LocaleController

    Alias: O.i18n

    This static class has methods for localising strings or dates and for
    registering and setting the user interface locale.
*/

/**
    Property (private): O.LocaleController-locales
    Type: Object

    Stores the loaded <O.Locale> instances.
*/
var locales = {
    xx: new NS.Locale({ code: 'xx' })
};

var alternatives = {
    'A': '[Aa\xaa\xc0-\xc5\xe0-\xe5\u0100-\u0105\u01cd\u01ce\u0200-\u0203\u0226\u0227\u1d2c\u1d43\u1e00\u1e01\u1e9a\u1ea0-\u1ea3\u2090\u2100\u2101\u213b\u249c\u24b6\u24d0\u3371-\u3374\u3380-\u3384\u3388\u3389\u33a9-\u33af\u33c2\u33ca\u33df\u33ff\uff21\uff41]',
    'B': '[Bb\u1d2e\u1d47\u1e02-\u1e07\u212c\u249d\u24b7\u24d1\u3374\u3385-\u3387\u33c3\u33c8\u33d4\u33dd\uff22\uff42]',
    'C': '[Cc\xc7\xe7\u0106-\u010d\u1d9c\u2100\u2102\u2103\u2105\u2106\u212d\u216d\u217d\u249e\u24b8\u24d2\u3376\u3388\u3389\u339d\u33a0\u33a4\u33c4-\u33c7\uff23\uff43]',
    'D': '[Dd\u010e\u010f\u01c4-\u01c6\u01f1-\u01f3\u1d30\u1d48\u1e0a-\u1e13\u2145\u2146\u216e\u217e\u249f\u24b9\u24d3\u32cf\u3372\u3377-\u3379\u3397\u33ad-\u33af\u33c5\u33c8\uff24\uff44]',
    'E': '[Ee\xc8-\xcb\xe8-\xeb\u0112-\u011b\u0204-\u0207\u0228\u0229\u1d31\u1d49\u1e18-\u1e1b\u1eb8-\u1ebd\u2091\u2121\u212f\u2130\u2147\u24a0\u24ba\u24d4\u3250\u32cd\u32ce\uff25\uff45]',
    'F': '[Ff\u1da0\u1e1e\u1e1f\u2109\u2131\u213b\u24a1\u24bb\u24d5\u338a-\u338c\u3399\ufb00-\ufb04\uff26\uff46]',
    'G': '[Gg\u011c-\u0123\u01e6\u01e7\u01f4\u01f5\u1d33\u1d4d\u1e20\u1e21\u210a\u24a2\u24bc\u24d6\u32cc\u32cd\u3387\u338d-\u338f\u3393\u33ac\u33c6\u33c9\u33d2\u33ff\uff27\uff47]',
    'H': '[Hh\u0124\u0125\u021e\u021f\u02b0\u1d34\u1e22-\u1e2b\u1e96\u210b-\u210e\u24a3\u24bd\u24d7\u32cc\u3371\u3390-\u3394\u33ca\u33cb\u33d7\uff28\uff48]',
    'I': '[Ii\xcc-\xcf\xec-\xef\u0128-\u0130\u0132\u0133\u01cf\u01d0\u0208-\u020b\u1d35\u1d62\u1e2c\u1e2d\u1ec8-\u1ecb\u2071\u2110\u2111\u2139\u2148\u2160-\u2163\u2165-\u2168\u216a\u216b\u2170-\u2173\u2175-\u2178\u217a\u217b\u24a4\u24be\u24d8\u337a\u33cc\u33d5\ufb01\ufb03\uff29\uff49]',
    'J': '[Jj\u0132-\u0135\u01c7-\u01cc\u01f0\u02b2\u1d36\u2149\u24a5\u24bf\u24d9\u2c7c\uff2a\uff4a]',
    'K': '[Kk\u0136\u0137\u01e8\u01e9\u1d37\u1d4f\u1e30-\u1e35\u212a\u24a6\u24c0\u24da\u3384\u3385\u3389\u338f\u3391\u3398\u339e\u33a2\u33a6\u33aa\u33b8\u33be\u33c0\u33c6\u33cd-\u33cf\uff2b\uff4b]',
    'L': '[Ll\u0139-\u0140\u01c7-\u01c9\u02e1\u1d38\u1e36\u1e37\u1e3a-\u1e3d\u2112\u2113\u2121\u216c\u217c\u24a7\u24c1\u24db\u32cf\u3388\u3389\u33d0-\u33d3\u33d5\u33d6\u33ff\ufb02\ufb04\uff2c\uff4c]',
    'M': '[Mm\u1d39\u1d50\u1e3e-\u1e43\u2120\u2122\u2133\u216f\u217f\u24a8\u24c2\u24dc\u3377-\u3379\u3383\u3386\u338e\u3392\u3396\u3399-\u33a8\u33ab\u33b3\u33b7\u33b9\u33bd\u33bf\u33c1\u33c2\u33ce\u33d0\u33d4-\u33d6\u33d8\u33d9\u33de\u33df\uff2d\uff4d]',
    'N': '[Nn\xd1\xf1\u0143-\u0149\u01ca-\u01cc\u01f8\u01f9\u1d3a\u1e44-\u1e4b\u207f\u2115\u2116\u24a9\u24c3\u24dd\u3381\u338b\u339a\u33b1\u33b5\u33bb\u33cc\u33d1\uff2e\uff4e]',
    'O': '[Oo\xba\xd2-\xd6\xf2-\xf6\u014c-\u0151\u01a0\u01a1\u01d1\u01d2\u01ea\u01eb\u020c-\u020f\u022e\u022f\u1d3c\u1d52\u1ecc-\u1ecf\u2092\u2105\u2116\u2134\u24aa\u24c4\u24de\u3375\u33c7\u33d2\u33d6\uff2f\uff4f]',
    'P': '[Pp\u1d3e\u1d56\u1e54-\u1e57\u2119\u24ab\u24c5\u24df\u3250\u3371\u3376\u3380\u338a\u33a9-\u33ac\u33b0\u33b4\u33ba\u33cb\u33d7-\u33da\uff30\uff50]',
    'Q': '[Qq\u211a\u24ac\u24c6\u24e0\u33c3\uff31\uff51]',
    'R': '[Rr\u0154-\u0159\u0210-\u0213\u02b3\u1d3f\u1d63\u1e58-\u1e5b\u1e5e\u1e5f\u20a8\u211b-\u211d\u24ad\u24c7\u24e1\u32cd\u3374\u33ad-\u33af\u33da\u33db\uff32\uff52]',
    'S': '[Ss\u015a-\u0161\u017f\u0218\u0219\u02e2\u1e60-\u1e63\u20a8\u2101\u2120\u24ae\u24c8\u24e2\u33a7\u33a8\u33ae-\u33b3\u33db\u33dc\ufb06\uff33\uff53]',
    'T': '[Tt\u0162-\u0165\u021a\u021b\u1d40\u1d57\u1e6a-\u1e71\u1e97\u2121\u2122\u24af\u24c9\u24e3\u3250\u32cf\u3394\u33cf\ufb05\ufb06\uff34\uff54]',
    'U': '[Uu\xd9-\xdc\xf9-\xfc\u0168-\u0173\u01af\u01b0\u01d3\u01d4\u0214-\u0217\u1d41\u1d58\u1d64\u1e72-\u1e77\u1ee4-\u1ee7\u2106\u24b0\u24ca\u24e4\u3373\u337a\uff35\uff55]',
    'V': '[Vv\u1d5b\u1d65\u1e7c-\u1e7f\u2163-\u2167\u2173-\u2177\u24b1\u24cb\u24e5\u2c7d\u32ce\u3375\u33b4-\u33b9\u33dc\u33de\uff36\uff56]',
    'W': '[Ww\u0174\u0175\u02b7\u1d42\u1e80-\u1e89\u1e98\u24b2\u24cc\u24e6\u33ba-\u33bf\u33dd\uff37\uff57]',
    'X': '[Xx\u02e3\u1e8a-\u1e8d\u2093\u213b\u2168-\u216b\u2178-\u217b\u24b3\u24cd\u24e7\u33d3\uff38\uff58]',
    'Y': '[Yy\xdd\xfd\xff\u0176-\u0178\u0232\u0233\u02b8\u1e8e\u1e8f\u1e99\u1ef2-\u1ef9\u24b4\u24ce\u24e8\u33c9\uff39\uff59]',
    'Z': '[Zz\u0179-\u017e\u01f1-\u01f3\u1dbb\u1e90-\u1e95\u2124\u2128\u24b5\u24cf\u24e9\u3390-\u3394\uff3a\uff5a]'
};

/**
    Property (private): O.LocaleController-active
    Type: O.Locale

    The active locale.
*/
var active = locales.xx;

var LocaleController = {
    /**
        Property: O.LocaleController.activeLocaleCode
        Type: String

        The locale code for the active locale.
    */
    activeLocaleCode: 'xx',

    /**
        Method: O.LocaleController.addLocale

        Registers a resource bundle with the class.

        Parameters:
            locale - {O.Locale} The locale instance containing translated
                     strings, date formats etc.

        Returns:
            {O.LocaleController} Returns self.
    */
    addLocale: function ( locale ) {
        locales[ locale.code ] = locale;
        return this;
    },

    /**
        Method: O.LocaleController.setLocale

        Sets a different locale as the active one. Will only have an effect if
        the resource bundle for this locale has already been loaded and
        registered with a call to addLocale. Future calls to localise() etc.
        will now use the resources from this locale.

        Parameters:
            localeCode - {String} The code for the locale to make active.

        Returns:
            {O.LocaleController} Returns self.
    */
    setLocale: function ( localeCode ) {
        if ( locales[ localeCode ] ) {
            active = locales[ localeCode ];
            this.activeLocaleCode = localeCode;
            if ( typeof Intl !== 'undefined' ) {
                this.compare = new Intl.Collator( localeCode, {
                    sensitivity: 'base'
                }).compare;
            }
        }
        return this;
    },

    /**
        Method: O.LocaleController.getLocale

        Returns a previously added locale object.

        Parameters:
            localeCode - {String} (optional) The code for the locale to return.
                       If not specified, the currently active locale will be
                       returned.

        Returns:
            {Locale|null} Returns the locale object (null if not present).
    */
    getLocale: function ( localeCode ) {
        return localeCode ? locales[ localeCode ] || null : active;
    },

    /**
        Function: O.LocaleController.get

        Gets a property from the active locale.

        Parameters:
            key - {String} The name of the property to fetch.

        Returns:
            {*} The value for that key.
    */
    get: function ( key ) {
        return active[ key ];
    },

    /**
        Function: O.LocaleController.localise

        Get a localised version of a string.

        Alias: O.loc

        Parameters:
            text     - {String} The string to localise.
            var_args - {...(String|Number)} The arguments to interpolate.

        Returns:
            {String} The localised string.
    */
    localise: function ( text ) {
        if ( arguments.length === 1 ) {
            var translation = active.translations[ text ];
            return translation !== undefined ? translation : text;
        } else {
            return active.translate.apply( active, arguments );
        }
    },

    /**
        Function: O.LocaleController.date

        Get a date or time formatted according to local conventions.

        Parameters:
            date - {...(String|Number|Object)} The arguments to interpolate.
            type - {String} The type of result you want, e.g. 'shortDate',
                   'time', 'fullDateAndTime'.
            utc  - {Boolean} (optional) If true, the UTC time of this date
                   object will be used when determining the day.

        Returns:
            {String} The localised date.
    */
    date: function ( date, type, utc ) {
        return active.getFormattedDate( date, type, utc );
    },

    /**
        Function: O.LocaleController.number

        Format a number according to local conventions. Ensures the correct
        symbol is used for a decimal point, and inserts thousands separators if
        used in the locale.

        Parameters:
            n - {(Number|String)} The number to format.

        Returns:
            {String} The localised number.
    */
    number: function ( n ) {
        return active.getFormattedNumber( n );
    },

    /**
        Function: O.LocaleController.ordinal

        Format an ordinal number according to local conventions, e.g. "1st",
        "42nd" or "53rd".

        Parameters:
            n - {Number} The number to format.

        Returns:
            {String} The localised ordinal.
    */
    ordinal: function ( n ) {
        return active.getFormattedOrdinal( n );
    },

    /**
        Function: O.LocaleController.fileSize

        Format a number of bytes into a locale-specific file size string.

        Parameters:
            bytes         - {Number} The number of bytes.
            decimalPlaces - {Number} (optional) The number of decimal places to
                            use in the result, if in MB or GB.

        Returns:
            {String} The localised, human-readable file size.
    */
    fileSize: function ( bytes, decimalPlaces ) {
        return active.getFormattedFileSize( bytes, decimalPlaces );
    },

    /**
        Function: O.LocaleController.compare

        Compares two strings in a case-insensitive manner in the custom of the
        current localisation.

        Parameters:
            a - {String} The first string.
            b - {String} The second string.

        Returns:
            {Number}
            `-1` => a is before b,
            `1`  => a is after b,
            `0`  => they are the same as far as this fn is concerned.
    */
    compare: function ( a, b ) {
        return a.toLowerCase().localeCompare( b.toLowerCase() );
    },

    /**
        Function: O.LocaleController.makeSearchRegExp

        Returns a regular expression that tests if another string starts with
        the given string, ignoring case and diacritic differences. e.g. if a
        string "foo" is supplied, the regexp returned would match the string
        "Foøso".

        Parameters:
            string - {String} The string to search for.

        Returns: {RegExp} A regular expression that will search for the string.
    */
    makeSearchRegExp: function ( string ) {
        return new RegExp(
            '(?:^|\\W)' +
            string.escapeRegExp().replace( /[A-Z]/gi, function ( letter ) {
                return alternatives[ letter.toUpperCase() ];
            }),
            'i'
        );
    }
};

NS.LocaleController = NS.i18n = LocaleController;
NS.loc = LocaleController.localise;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RelativeDate.js                                                      \\
// Module: Localisation                                                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Function: Date.formatDuration

    Formats the duration given into a localised string, e.g. "5 hours" or
    "3 weeks 2 days".

    Parameters:
        durationInMS - The duration in milliseconds to format.
        approx       - If true, only show most significant unit.

    Returns:
        {String} The formatted duration.
*/
var formatDuration = Date.formatDuration = function ( durationInMS, approx ) {
    var durationInSeconds = Math.abs( Math.floor( durationInMS / 1000 ) ),
        time, weeks, days, hours, minutes;

    if ( durationInSeconds < 60 ) {
        time = NS.loc( 'less than a minute' );
    } else if ( durationInSeconds < 60 * 60 ) {
        time = NS.loc( '[*2,_1,%n minute,%n minutes]',
            ~~( durationInSeconds / 60 ) );
    } else if ( durationInSeconds < 60 * 60 * 24 ) {
        if ( approx ) {
            hours = Math.round( durationInSeconds / ( 60 * 60 ) );
            minutes = 0;
        } else {
            hours = ~~( durationInSeconds / ( 60 * 60 ) );
            minutes = ~~( ( durationInSeconds / 60 ) % 60 );
        }
        time = NS.loc( '[*2,_1,%n hour,%n hours,] [*2,_2,%n minute,%n minutes,]', hours, minutes );
    } else if ( approx ? durationInSeconds < 60 * 60 * 24 * 21 :
            durationInSeconds < 60 * 60 * 24 * 7 ) {
        if ( approx ) {
            days = Math.round( durationInSeconds / ( 60 * 60 * 24 ) );
            hours = 0;
        } else {
            days = ~~( durationInSeconds / ( 60 * 60 * 24 ) );
            hours = ~~( ( durationInSeconds / ( 60 * 60 ) ) % 24 );
        }
        time = NS.loc( '[*2,_1,%n day,%n days,] [*2,_2,%n hour,%n hours,]',
            days, hours );
    } else {
        if ( approx ) {
            weeks = Math.round( durationInSeconds / ( 60 * 60 * 24 * 7 ) );
            days = 0;
        } else {
            weeks = ~~( durationInSeconds / ( 60 * 60 * 24 * 7 ) );
            days = ~~( durationInSeconds / ( 60 * 60 * 24 ) ) % 7;
        }
        time = NS.loc( '[*2,_1,%n week,%n weeks,] [*2,_2,%n day,%n days,]',
            weeks, days );
    }
    return time.trim();
};

Date.implement({
    /**
        Method: Date#relativeTo

        Returns the difference in time between the date given in the sole
        argument (or now if not supplied) and this date, in a human friendly,
        localised form. e.g. 5 hours 3 minutes ago.

        Parameters:
            date   - {Date} Date to compare it to.
            approx - {Boolean} (optional) If true, only return a string for the
                     most significant part of the relative time (e.g. just "5
                     hours ago" instead of "5 hours 34 mintues ago").

        Returns:
            {String} Relative date string.
    */
    relativeTo: function ( date, approx ) {
        if ( !date ) { date = new Date(); }

        var duration = ( date - this ),
            isFuture = ( duration < 0 ),
            time, years, months;

        if ( isFuture ) {
            duration = -duration;
        }
        // Less than a day
        if ( duration < 1000 * 60 * 60 * 24 ) {
            time = formatDuration( duration, approx );
        }
        // Less than 6 weeks
        else if ( duration < 1000 * 60 * 60 * 24 * 7 * 6 ) {
            if ( approx ) {
                duration = new Date(
                    date.getFullYear(),
                    date.getMonth(),
                    date.getDate()
                ) - new Date(
                    this.getFullYear(),
                    this.getMonth(),
                    this.getDate()
                );
            }
            time = formatDuration( duration, approx );
        }
        else {
            years = date.getFullYear() - this.getFullYear();
            months = date.getMonth() - this.getMonth();

            if ( isFuture ) {
                years = -years;
                months = -months;
            }
            if ( months < 0 ) {
                years -= 1;
                months += 12;
            }
            time =
                NS.loc( '[*2,_1,%n year,%n years,] [*2,_2,%n month,%n months,]',
                    years, months ).trim();
        }

        return isFuture ?
            NS.loc( '[_1] from now', time ) : NS.loc( '[_1] ago', time );
    }
});

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Parse.js                                                             \\
// Module: Parser                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var Parse = NS.Class({
    init: function ( string, tokens ) {
        this.string = string;
        this.tokens = tokens || [];
    },
    clone: function () {
        return new Parse( this.string, this.tokens.slice() );
    },
    assimilate: function ( parse ) {
        this.string = parse.string;
        this.tokens = parse.tokens;
    }
});

Parse.define = function ( name, regexp, context ) {
    return function ( parse ) {
        var string = parse.string,
            result = regexp.exec( string ),
            part;
        if ( result ) {
            part = result[0];
            parse.tokens.push([ name, part, context || null ]);
            parse.string = string.slice( part.length );
        }
        return !!result;
    };
};

Parse.optional = function ( pattern ) {
    return function ( parse ) {
        pattern( parse );
        return true;
    };
};

Parse.not = function ( pattern ) {
    return function ( parse ) {
        var newParse = parse.clone();
        return !pattern( newParse );
    };
};

Parse.repeat = function ( pattern, min, max ) {
    // Max int: 2^31 - 1;
    if ( !max ) { max = 2147483647; }
    return function ( parse ) {
        var newParse = parse.clone(),
            i = 0;
        do {
            if ( pattern( newParse ) ) {
                i += 1;
            } else {
                break;
            }
        } while ( i < max );
        if ( i >= min ) {
            if ( i ) {
                parse.assimilate( newParse );
            }
            return true;
        }
        return false;
    };
};

Parse.sequence = function ( patterns ) {
    return function ( parse ) {
        var newParse = parse.clone();
        for ( var i = 0, l = patterns.length; i < l; i += 1 ) {
            if ( !patterns[i]( newParse ) ) {
                return false;
            }
        }
        // Successful: copy over results of parse
        parse.assimilate( newParse );
        return true;
    };
};

Parse.firstMatch = function ( patterns ) {
    return function ( parse ) {
        for ( var i = 0, l = patterns.length; i < l; i += 1 ) {
            if ( patterns[i]( parse ) ) {
                return true;
            }
        }
        return false;
    };
};

Parse.longestMatch = function ( patterns ) {
    return function ( parse ) {
        var parses = [],
            i, l, newParse;
        for ( i = 0, l = patterns.length; i < l; i += 1 ) {
            newParse = parse.clone();
            if ( patterns[i]( newParse ) ) {
                parses.push( newParse );
                // Have we found a perfect parse? If so, stop.
                if ( !newParse.string ) {
                    break;
                }
            }
        }
        // Find the parse with shortest string left over.
        l = parses.length;
        if ( l-- ) {
            newParse = parses[l];
            while ( l-- ) {
                if ( parses[l].string.length <= newParse.string.length ) {
                    newParse = parses[l];
                }
            }
            parse.assimilate( newParse );
            return true;
        }
        return false;
    };
};

NS.Parse = Parse;

NS.parse = {};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: DateParser.js                                                        \\
// Module: Parser                                                             \\
// Requires: Localisation, Parse.js                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

// --- Date Grammar ---

var JUST_TIME = 1,
    JUST_DATE = 2,
    DATE_AND_TIME = 3;

var generateLocalisedDateParser = function ( locale, mode ) {
    var Parse = NS.Parse,
        define = Parse.define,
        optional = Parse.optional,
        not = Parse.not,
        sequence = Parse.sequence,
        firstMatch = Parse.firstMatch,
        longestMatch = Parse.longestMatch;

    var datePatterns = locale.datePatterns;

    var anyInLocale = function ( type, names ) {
        return firstMatch(
            names.split( ' ' ).map( function ( name ) {
                return define( type, datePatterns[ name ], name );
            })
        );
    };

    var whitespace = define( 'whitespace', (/^(?:[\s"']+|$)/) );

    var hours = define( 'hour', /^(?:2[0-3]|[01]?\d)/ ),
        minutes = define( 'minute', /^[0-5][0-9]/ ),
        seconds = define( 'second', /^[0-5][0-9]/ ),
        meridian = firstMatch([
            define( 'am', datePatterns.am ),
            define( 'pm', datePatterns.pm )
        ]),
        timeSuffix = sequence([
            optional( whitespace ),
            meridian
        ]),
        timeDelimiter = define( 'timeDelimiter', ( /^[:.]/ ) ),
        timeContext = define( 'timeContext', datePatterns.timeContext ),
        time = sequence([
            hours,
            optional( sequence([
                timeDelimiter,
                minutes,
                optional( sequence([
                    timeDelimiter,
                    seconds
                ]))
            ])),
            optional(
                timeSuffix
            ),
            whitespace
        ]);

    if ( mode === JUST_TIME ) {
        return firstMatch([
            time,
            sequence([
                hours,
                minutes
            ]),
            whitespace
        ]);
    }

    var ordinalSuffix = define( 'ordinalSuffix', datePatterns.ordinalSuffix ),

        weekday = anyInLocale( 'weekday', 'sun mon tue wed thu fri sat' ),
        day = sequence([
            define( 'day', /^(?:[0-2]\d|3[0-1]|\d)/ ),
            optional( ordinalSuffix ),
            not( timeContext )
        ]),
        monthnumber = sequence([
            define( 'month', /^(?:1[0-2]|0\d|\d)/ ),
            not( firstMatch([
                timeContext,
                ordinalSuffix
            ]))
        ]),
        monthname = anyInLocale( 'monthname',
            'jan feb mar apr may jun jul aug sep oct nov dec' ),
        month = firstMatch([
            monthnumber,
            monthname
        ]),
        fullyear = define( 'year', /^\d{4}/ ),
        year = sequence([
            define( 'year', /^\d\d(?:\d\d)?/ ),
            not( firstMatch([
                timeContext,
                ordinalSuffix
            ]))
        ]),
        searchMethod = anyInLocale( 'searchMethod', 'past future' ),

        dateDelimiter = define( 'dateDelimiter',
            ( /^(?:[\s\-\.\,\'\/]|of)+/ ) ),

        relativeDate = anyInLocale( 'relativeDate',
            'yesterday tomorrow today now' ),

        standardDate = sequence(
            locale.dateFormats.date.split( /%\-?([dmbY])/ ).map(
            function ( part, i ) {
                if ( i & 1 ) {
                    switch ( part ) {
                    case 'd':
                        return day;
                    case 'm':
                        return monthnumber;
                    case 'b':
                        return monthname;
                    case 'Y':
                        return year;
                    }
                } else if ( part ) {
                    return define( 'dateDelimiter',
                        new RegExp( '^' + part.escapeRegExp() )
                    );
                }
                return null;
            }).filter( function ( x ) { return !!x; } )
        ),

        dayMonthYear = sequence([
            day,
            dateDelimiter,
            month,
            dateDelimiter,
            year
        ]),
        dayMonth = sequence([
            day,
            dateDelimiter,
            month
        ]),
        monthYear = sequence([
            month,
            dateDelimiter,
            year,
            not( timeContext )
        ]),
        monthDayYear = sequence([
            month,
            dateDelimiter,
            day,
            dateDelimiter,
            year
        ]),
        monthDay = sequence([
            month,
            dateDelimiter,
            day
        ]),
        yearMonthDay = sequence([
            year,
            dateDelimiter,
            month,
            dateDelimiter,
            day
        ]),
        yearMonth = sequence([
            year,
            dateDelimiter,
            month
        ]),

        date = sequence([
            firstMatch([
                standardDate,
                longestMatch(
                    locale.dateElementOrder === 'dmy' ? [
                        dayMonthYear,
                        dayMonth,
                        monthYear,
                        monthDayYear,
                        monthDay,
                        yearMonthDay,
                        yearMonth
                    ] : locale.dateElementOrder === 'mdy' ?     [
                        monthDayYear,
                        monthDay,
                        monthYear,
                        dayMonthYear,
                        dayMonth,
                        yearMonthDay,
                        yearMonth
                    ] : [
                        yearMonthDay,
                        yearMonth,
                        dayMonthYear,
                        dayMonth,
                        monthYear,
                        monthDayYear,
                        monthDay
                    ]
                )
            ]),
            not( define( '', /^\d/ ) )
        ]);

    if ( mode === JUST_DATE ) {
        return firstMatch([
            date,
            weekday,
            fullyear,
            monthname,
            day,
            relativeDate,
            searchMethod,
            whitespace
        ]);
    }

    return firstMatch([
        date,
        time,
        weekday,
        fullyear,
        monthname,
        day,
        relativeDate,
        searchMethod,
        whitespace
    ]);
};

// --- Interpreter ---

var monthNameToIndex = 'jan feb mar apr may jun jul aug sep oct nov dec'
    .split( ' ' )
    .reduce( function ( monthNameToIndex, name, i ) {
        monthNameToIndex[ name ] = i;
        return monthNameToIndex;
    }, {} );

var dayNameToIndex = 'sun mon tue wed thu fri sat'
    .split( ' ' )
    .reduce( function ( dayNameToIndex, name, i ) {
        dayNameToIndex[ name ] = i;
        return dayNameToIndex;
    }, {} );

var isLeapYear = Date.isLeapYear;
var getDaysInMonth = Date.getDaysInMonth;

var NOW = 0;
var PAST = -1;
var FUTURE = 1;

var interpreter = {
    interpret: function ( tokens, implicitSearchMethod ) {
        var date = {},
            i, l, token, name;
        for ( i = 0, l = tokens.length; i < l; i += 1 ) {
            token = tokens[i];
            name = token[0];
            if ( this[ name ] ) {
                this[ name ]( date, token[1], token[2], tokens );
            }
        }
        return this.findDate( date, date.searchMethod || implicitSearchMethod );
    },
    findDate: function ( constraints, searchMethod ) {
        var keys = Object.keys( constraints );
        if ( !keys.length ) {
            return null;
        }
        var date = new Date(),
            currentDay = date.getDate();

        // If we don't do this, setting month lower down could go wrong,
        // because if the date is 30th and we set month as Feb, we'll end up
        // in March!
        date.setDate( 1 );

        // Time:
        date.setHours( constraints.hour || 0 );
        date.setMinutes( constraints.minute || 0 );
        date.setSeconds( constraints.second || 0 );
        date.setMilliseconds( 0 );

        // Date:
        var day = constraints.day,
            month = constraints.month,
            year = constraints.year,
            weekday = constraints.weekday,

            hasMonth = !!( month || month === 0 ),
            hasWeekday = !!( weekday || weekday === 0 ),

            dayInMs = 86400000,
            currentMonth, isFeb29, delta;

        if ( day && hasMonth && year ) {
            if ( day > getDaysInMonth( month, year ) ) {
                date = null;
            } else {
                date.setFullYear( year );
                date.setMonth( month );
                date.setDate( day );
            }
        } else if ( hasMonth && year ) {
            date.setFullYear( year );
            date.setMonth( month );
            if ( hasWeekday ) {
                if ( searchMethod !== PAST ) {
                    // Date is currently 1.
                    day = ( weekday - date.getDay() ).mod( 7 ) + 1;
                } else {
                    date.setDate( day = getDaysInMonth( month, year ) );
                    day = day - ( date.getDay() - weekday ).mod( 7 );
                }
            } else {
                day = 1;
            }
            date.setDate( day );
        } else if ( day && hasMonth ) {
            currentMonth = date.getMonth();
            year = date.getFullYear();
            // We just use the current year if searchMethod === NOW
            // If it's FUTURE or PAST though, make sure the date conforms to
            // that.
            if ( searchMethod === FUTURE ) {
                if ( month < currentMonth ||
                        ( month === currentMonth && day <= currentDay ) ) {
                    year += 1;
                }
            }
            if ( searchMethod === PAST ) {
                if ( month > currentMonth ||
                        ( month === currentMonth && day >= currentDay ) ) {
                    year -= 1;
                }
            }
            date.setFullYear( year );
            date.setMonth( month );
            date.setDate( day );
            // If we have a weekday constraint, iterate in the past or future
            // direction until we find a year where that matches.
            if ( hasWeekday ) {
                isFeb29 = ( day === 29 && month === 1 );
                if ( isFeb29 ) {
                    while ( !isLeapYear( year ) ) {
                        year += ( searchMethod || 1 );
                    }
                    date.setFullYear( year );
                }
                delta = ( isFeb29 ? 4 : 1 ) * ( searchMethod || 1 ) ;
                while ( date.getDay() !== weekday ) {
                    do {
                        year += delta;
                    } while ( isFeb29 && !isLeapYear( year ) );
                    date.setFullYear( year );
                }
            }
        } else if ( day ) {
            year = date.getFullYear();
            month = date.getMonth();
            date.setDate( day );
            if ( hasWeekday ) {
                // Find month which satisfies this.
                while ( date.getDay() !== weekday || date.getDate() !== day ) {
                    if ( searchMethod === PAST ) {
                        if ( month ) {
                            month -= 1;
                        } else {
                            year -= 1;
                            month = 11;
                        }
                    } else {
                        if ( month < 11 ) {
                            month += 1;
                        } else {
                            year += 1;
                            month = 0;
                        }
                    }
                    date.setFullYear( year );
                    date.setMonth( month );
                    date.setDate( day );
                }
            }
        } else if ( hasMonth ) {
            year = date.getFullYear();
            currentMonth = date.getMonth();
            // We just use the current year if searchMethod === NOW
            // If it's FUTURE or PAST though, make sure the date conforms to
            // that.
            if ( searchMethod === FUTURE && month <= currentMonth ) {
                year += 1;
            }
            if ( searchMethod === PAST && month > currentMonth ) {
                year -= 1;
            }
            date.setFullYear( year );
            date.setMonth( month );

            if ( hasWeekday ) {
                if ( searchMethod !== PAST ) {
                    day = ( weekday - date.getDay() ).mod( 7 ) + 1;
                } else {
                    date.setDate( day = getDaysInMonth( month, year ) );
                    day = day - ( date.getDay() - weekday ).mod( 7 );
                }
                date.setDate( day );
            }
        } else if ( year ) {
            date.setFullYear( year );
            date.setMonth( 0 );
            if ( hasWeekday ) {
                if ( searchMethod !== PAST ) {
                    day = ( weekday - date.getDay() ).mod( 7 ) + 1;
                } else {
                    date.setMonth( 11 );
                    date.setDate( day = getDaysInMonth( 11, year ) );
                    day = day - ( date.getDay() - weekday ).mod( 7 );
                }
                date.setDate( day );
            }
        } else if ( hasWeekday ) {
            date.setDate( currentDay );
            if ( searchMethod === PAST ) {
                date.setTime( date.getTime() - dayInMs );
                date.setTime( date.getTime() -
                    ( dayInMs * ( date.getDay() - weekday ).mod( 7 ) ) );
            } else {
                date.setTime( date.getTime() + dayInMs );
                date.setTime( date.getTime() +
                    ( dayInMs * ( weekday - date.getDay() ).mod( 7 ) ) );
            }
        }

        return date;
    },

    weekday: function ( date, string, weekday ) {
        date.weekday = dayNameToIndex[ weekday ];
    },
    day: function ( date, string ) {
        date.day = +string;
    },
    month: function ( date, string ) {
        date.month = +string - 1;
    },
    monthname: function ( date, string, name ) {
        date.month = monthNameToIndex[ name ];
    },
    year: function ( date, string ) {
        var year = +string;
        if ( string.length === 2 ) {
            year += 2000;
            if ( year > new Date().getFullYear() + 30 ) {
                year -= 100;
            }
        }
        date.year = year;
    },
    hour: function ( date, string ) {
        date.hour = +string;
        var meridian = date.meridian;
        if ( meridian ) {
            this[ meridian ]( date );
        }
    },
    minute: function ( date, string ) {
        date.minute = +string;
    },
    second: function ( date, string ) {
        date.second = +string;
    },
    am: function ( date ) {
        date.meridian = 'am';
        var hour = date.hour;
        if ( hour && hour === 12 ) {
            date.hour = 0;
        }
    },
    pm: function ( date ) {
        date.meridian = 'pm';
        var hour = date.hour;
        if ( hour && hour < 12 ) {
            date.hour = hour + 12;
        }
    },
    searchMethod: function ( date, string, pastOrFuture ) {
        date.searchMethod = ( pastOrFuture === 'past' ) ? PAST : FUTURE;
    },
    relativeDate: function ( date, string, context ) {
        var now = new Date(),
            dayInMs = 86400000;
        switch ( context ) {
            case 'yesterday':
                now.setTime( now.getTime() - dayInMs );
                break;
            case 'tomorrow':
                now.setTime( now.getTime() + dayInMs );
                break;
        }
        date.day = now.getDate();
        date.month = now.getMonth();
        date.year = now.getFullYear();
    }
};

// ---

var unknown = NS.Parse.define( 'unknown', /^[^\s]+/ );

var dateParsers = {};
var parseDateTime = function ( string, locale, mode ) {
    if ( !locale ) {
        locale = NS.i18n.getLocale();
    }
    var code = locale.code + mode;
    var dateParser = dateParsers[ code ] ||
        ( dateParsers[ code ] = generateLocalisedDateParser( locale, mode ) );
    var parse = new NS.Parse( string.trim() );
    while ( parse.string.length ) {
        if ( !dateParser( parse ) ) {
            // We've hit something unexpected. Skip it.
            unknown( parse );
        }
    }
    return parse.tokens;
};

NS.parse.tokeniseDateTime = parseDateTime;
NS.parse.interpretDateTime = function ( tokens, implicitSearchMethod ) {
    return interpreter.interpret( tokens, implicitSearchMethod || NOW );
};

NS.parse.time = function ( string, locale ) {
    var tokens = parseDateTime( string, locale, JUST_TIME );
    return interpreter.interpret( tokens );
};

NS.parse.date = function ( string, locale, implicitPast ) {
    var tokens = parseDateTime( string, locale, JUST_DATE );
    return interpreter.interpret( tokens, implicitPast ? PAST : NOW );
};

NS.parse.dateTime = function ( string, locale, implicitPast ) {
    var tokens = parseDateTime( string, locale, DATE_AND_TIME );
    return interpreter.interpret( tokens, implicitPast ? PAST : NOW );
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: SelectionController.js                                               \\
// Module: Selection                                                          \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var SelectionController = NS.Class({

    Extends: NS.Object,

    content: NS.bind( 'view.content' ),

    init: function ( mixin ) {
        this._selectionId = 0;
        this._lastSelectedIndex = 0;
        this._selectedIds = {};

        this.isLoadingSelection = false;
        this.view = null;
        this.length = 0;

        SelectionController.parent.init.call( this, mixin );

        var content = this.get( 'content' );
        if ( content ) {
            content.on( 'query:updated', this, 'contentWasUpdated' );
        }
    },

    contentDidChange: function ( _, __, oldContent, newContent ) {
        if ( oldContent ) {
            oldContent.off( 'query:updated', this, 'contentWasUpdated' );
        }
        if ( newContent ) {
            newContent.on( 'query:updated', this, 'contentWasUpdated' );
        }
        this._selectedIds = {};
        this.set( 'length', 0 )
            .propertyDidChange( 'selectedIds' );
    }.observes( 'content' ),

    contentWasUpdated: function ( event ) {
        // If an id has been removed, it may no
        // longer belong to the selection
        var _selectedIds = this._selectedIds,
            length = this.get( 'length' ),
            removed = event.removed || [],
            added = event.added.reduce( function ( set, id ) {
                set[ id ] = true;
                return set;
            }, {} ),
            l = removed.length,
            id;

        while ( l-- ) {
            id = removed[l];
            if ( _selectedIds[ id ] && !added[ id ] ) {
                length -= 1;
                delete _selectedIds[ id ];
            }
        }

        this.set( 'length', length )
            .propertyDidChange( 'selectedIds' );
    },

    // ---

    selectedIds: function () {
        return Object.keys( this._selectedIds );
    }.property().nocache(),

    isIdSelected: function ( id ) {
        return !!this._selectedIds[ id ];
    },

    updateViews: function () {
        var itemViews = this.getFromPath( 'view.childViews' ),
            l = itemViews ? itemViews.length : 0,
            _selectedIds = this._selectedIds,
            view, id;
        while ( l-- ) {
            view = itemViews[l];
            id = view.getFromPath( 'content.id' );
            if ( id ) {
                view.set( 'isSelected', !!_selectedIds[ id ] );
            }
        }
    }.observes( 'selectedIds' ),

    // ---

    selectIds: function ( ids, isSelected, _selectionId ) {
        if ( _selectionId && _selectionId !== this._selectionId ) {
            return;
        }
        // Make sure we've got a boolean
        isSelected = !!isSelected;

        var _selectedIds = this._selectedIds,
            howManyChanged = 0,
            l = ids.length,
            id, wasSelected;

        while ( l-- ) {
            id = ids[l];
            wasSelected = !!_selectedIds[ id ];
            if ( isSelected !== wasSelected ) {
                if ( isSelected ) {
                    _selectedIds[ id ] = true;
                }
                else {
                    delete _selectedIds[ id ];
                }
                howManyChanged += 1;
            }
        }

        if ( howManyChanged ) {
            this.increment( 'length',
                    isSelected ? howManyChanged : -howManyChanged )
                .propertyDidChange( 'selectedIds' );
        }

        this.set( 'isLoadingSelection', false );
    },

    selectIndex: function ( index, isSelected, includeRangeFromLastSelected ) {
        var lastSelectedIndex = this._lastSelectedIndex,
            start = includeRangeFromLastSelected ?
                Math.min( index, lastSelectedIndex ) : index,
            end = ( includeRangeFromLastSelected ?
                Math.max( index, lastSelectedIndex ) : index ) + 1;
        this._lastSelectedIndex = index;
        return this.selectRange( start, end, isSelected );
    },

    selectRange: function ( start, end, isSelected ) {
        var content = this.get( 'content' ),
            selectionId = ( this._selectionId += 1 ),
            loading = content.getIdsForObjectsInRange(
                start, end = Math.min( end, content.get( 'length' ) || 0 ),
                function ( ids, start, end ) {
                    this.selectIds( ids, isSelected, selectionId, start, end );
                }.bind( this )
            );

        if ( loading ) {
            this.set( 'isLoadingSelection', true );
        }

        return this;
    },

    selectAll: function ( isSelected ) {
        var content = this.get( 'content' ),
            selectionId = ( this._selectionId += 1 );

        if ( isSelected ) {
            var loading = content.getIdsForAllObjects(
                function ( ids, start, end ) {
                    this.selectIds( ids, true, selectionId, start, end );
                }.bind( this )
            );
            if ( loading ) {
                this.set( 'isLoadingSelection', true );
            }
        }
        else {
            this._selectedIds = {};
            this.set( 'length', 0 )
                .propertyDidChange( 'selectedIds' )
                .set( 'isLoadingSelection', false );
        }

        return this;
    }
});

NS.SelectionController = SelectionController;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: SingleSelectionController.js                                         \\
// Module: Selection                                                          \\
// Requires: Core, Foundation, DataStore                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var READY = NS.Status.READY;

var SingleSelectionController = NS.Class({

    Extends: NS.Object,

    allowNoSelection: true,

    init: function ( mixin ) {
        this._ignore = false;
        this._range = { start: -1, end: 0 };

        this.content = null;
        this.record = null;
        this.index = -1;
        this.isFetchingIndex = false;

        SingleSelectionController.parent.init.call( this, mixin );

        var content = this.get( 'content' );
        if ( content ) {
            this.contentDidChange( null, '', null, content );
        }
    },

    destroy: function () {
        var content = this.get( 'content' );
        if ( content ) {
            content.off( 'query:reset', this, 'contentWasReset' )
                   .off( 'query:updated', this, 'contentWasUpdated' );
            content.removeObserverForRange(
                this._range, this, 'recordAtIndexDidChange' );
        }
        SingleSelectionController.parent.destroy.call( this );
    },

    recordAtIndexDidChange: function () {
        if ( !this.get( 'record' ) ) {
            var content = this.get( 'content' );
            this.set( 'record', content &&
                content.getObjectAt( this.get( 'index' ) ) ||
                null
            );
        }
    }.queue( 'before' ),

    _indexDidChange: function () {
        var list = this.get( 'content' ),
            length = list ? list.get( 'length' ) : 0,
            index = this.get( 'index' ),
            range = this._range,
            record;
        range.start = index;
        range.end = index + 1;
        if ( !this._ignore ) {
            if ( ( index < 0 && !this.get( 'allowNoSelection' ) ) ||
                    ( !length && index > 0 ) ) {
                this.set( 'index', 0 );
            } else if ( length > 0 && index >= length ) {
                this.set( 'index', length - 1 );
            } else {
                if ( length && index > -1 ) {
                    record = list.getObjectAt( index );
                }
                this._ignore = true;
                this.set( 'record', record || null );
                this._ignore = false;
            }
        }
    }.observes( 'index' ),

    _recordDidChange: function () {
        if ( !this._ignore ) {
            var record = this.get( 'record' ),
                list = this.get( 'content' );
            // If both content and record are bound, content *must* be synced
            // first in order to look for the new record in the new list.
            // If changed, return as the new record will be handled by the
            // setRecordInNewContent fn.
            var binding = NS.meta( this ).bindings.content;
            if ( binding ) {
                this._ignore = true;
                binding.sync();
                this._ignore = false;
            }
            if ( record && list ) {
                this.set( 'isFetchingIndex', true );
                list.indexOfId(
                    record.toIdOrStoreKey(),
                    0,
                    function ( index ) {
                        if ( this.get( 'record' ) === record &&
                                this.get( 'content' ) === list ) {
                            this._ignore = true;
                            this.set( 'index', index );
                            this._ignore = false;
                            this.set( 'isFetchingIndex', false );
                        }
                    }.bind( this )
                );
            } else if ( record || this.get( 'allowNoSelection' ) ) {
                this._ignore = true;
                this.set( 'index', -1 );
                this._ignore = false;
            }
        }
    }.observes( 'record' ),

    setRecordInNewContent: function ( list ) {
        // If fetching an explicit index, we've already set the explicit
        // record we want; don't change it.
        if ( this.get( 'isFetchingIndex' ) ) {
            return;
        }
        // If we're about to sync a new record, nothing to do
        var binding = NS.meta( this ).bindings.record;
        if ( binding && binding.isNotInSync && binding.willSyncForward ) {
            return;
        }

        var allowNoSelection = this.get( 'allowNoSelection' ),
            record = this.get( 'record' ),
            index = allowNoSelection ? -1 : 0;

        // Race condition check: has the content property changed since the
        // SingleSelectionController#contentBecameReady call?
        if ( list !== this.get( 'content' ) ) {
            return;
        }

        // See if the currently set record exists in the new list. If it does,
        // we'll use that.
        if ( record ) {
            index = list.indexOfId( record.toIdOrStoreKey() );
            if ( !allowNoSelection && index < 0 ) {
                index = 0;
            }
        }

        if ( index === this.get( 'index' ) ) {
            record = list.getObjectAt( index );
            this.set( 'record', record || null );
        } else {
            this.set( 'index', index );
        }
    },

    contentDidChange: function ( _, __, oldVal, newVal ) {
        var range = this._range;
        if ( oldVal ) {
            oldVal.off( 'query:reset', this, 'contentWasReset' )
                  .off( 'query:updated', this, 'contentWasUpdated' );
            oldVal.removeObserverForRange(
                range, this, 'recordAtIndexDidChange' );
            oldVal.removeObserverForKey( 'status', this, 'contentBecameReady' );
        }
        if ( newVal ) {
            newVal.addObserverForRange( range, this, 'recordAtIndexDidChange' );
            newVal.on( 'query:updated', this, 'contentWasUpdated' )
                  .on( 'query:reset', this, 'contentWasReset' );
            this.set( 'isFetchingIndex', false );
            // If we're already setting the record, nothing to do.
            if ( !this._ignore ) {
                if ( newVal.is( READY ) ) {
                    this.setRecordInNewContent( newVal );
                } else {
                    newVal.addObserverForKey(
                        'status', this, 'contentBecameReady' );
                }
            }
        }
    }.observes( 'content' ),

    contentBecameReady: function ( list, key ) {
        if ( list.is( READY ) ) {
            list.removeObserverForKey( key, this, 'contentBecameReady' );
            // Queue so that all data from the server will have been loaded
            // into the list.
            NS.RunLoop.queueFn( 'before',
                this.setRecordInNewContent.bind( this, list ) );
        }
    },

    contentWasUpdated: function ( updates ) {
        var record = this.get( 'record' ),
            index = record ? updates.added.indexOf( record.get( 'id' ) ) : -1,
            removedIndexes = updates.removedIndexes,
            addedIndexes = updates.addedIndexes,
            content = this.get( 'content' ),
            change = 0,
            i, l;

        // No current record, no update of position required.
        if ( !record ) {
            return;
        }

        if ( index > -1 ) {
            index = addedIndexes[ index ];
        } else {
            index = this.get( 'index' );
            // Can't update a position not currently in the list.
            if ( index === -1 ) {
                return;
            }
            for ( i = 0, l = removedIndexes.length; i < l; i += 1 ) {
                if ( removedIndexes[i] < index ) { change += 1; }
                // Guaranteed in ascending order.
                else { break; }
            }
            index -= change;
            for ( i = 0, l = addedIndexes.length; i < l; i += 1 ) {
                if ( addedIndexes[i] <= index ) { index += 1; }
                // Guaranteed in ascending order.
                else { break; }
            }
        }
        index = Math.min( index,
            ( ( content && content.get( 'length' ) ) || 1 ) - 1 );
        if ( index === this.get( 'index' ) ) {
            record = content && content.getObjectAt( index );
            this.set( 'record', record || null );
        } else {
            this.set( 'index', index );
        }
    },

    contentWasReset: function () {
        this._recordDidChange();
    }
});

NS.SingleSelectionController = SingleSelectionController;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: LocalStorage.js                                                      \\
// Module: Storage                                                            \\
// Requires: Core, Foundation                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global location, sessionStorage, localStorage */

( function ( NS, undefined ) {

/**
    Module: Storage

    The Storage module provides classes for persistant storage in the client.
*/

var dummyStorage = {
    setItem: function () {},
    getItem: function () {}
};

/**
    Class: O.LocalStorage

    Extends: O.Object

    LocalStorage provides an observable object interface to the local/session
    storage facilities provided by modern browsers. Essentially, you can treat
    it as an instance of <O.Object> whose values persists between page reloads
    (and between browser sessions if not set to session-only).

    Since data is serialised to a string for storage, only native JS types
    should be stored; class instances will not be restored correctly.
*/
var LocalStorage = NS.Class({

    Extends: NS.Object,

    /**
        Constructor: O.LocalStorage

        Parameters:
            name        - {String} The name of this storage set. Objects with
                          the same name will overwrite each others' values.
            sessionOnly - {Boolean} (optional) Should the values only be
                          persisted for the session?
    */
    init: function ( name, sessionOnly ) {
        this._name = name + '.';
        this._store = location.protocol === 'file:' ? dummyStorage :
            sessionOnly ? sessionStorage : localStorage;

        LocalStorage.parent.init.call( this );
    },

    get: function ( key ) {
        if ( !( key in this ) ) {
            var item;
            // Firefox sometimes throws and error
            try {
                item = this._store.getItem( this._name + key );
            } catch ( error ) {}
            return item ? ( this[ key ] = JSON.parse( item ) ) : undefined;
        }
        return LocalStorage.parent.get.call( this, key );
    },

    set: function ( key, value ) {
        // If we exceed the storage quota, an error will be thrown.
        try {
            this._store.setItem( this._name + key, JSON.stringify( value ) );
        } catch ( error ) {}
        return LocalStorage.parent.set.call( this, key, value );
    }
});

NS.LocalStorage = LocalStorage;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: TimeZone.js                                                          \\
// Module: TimeZones                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

// Periods format:
// until posix time, offset (secs), rules name, suffix
// e.g. [ +new Date(), -3600, 'EU', 'CE%sT' ]

var getPeriod = function ( periods, date, isUTC ) {
    var l = periods.length - 1,
        period, candidate;
    period = periods[l];
    while ( l-- ) {
        candidate = periods[l];
        if ( candidate[0] < date - ( isUTC ? 0 : candidate[1] ) ) {
            break;
        }
        period = candidate;
    }
    return period;
};

// Rules format:
// start year, end year, month, date, day, hour, minute, second,
//      utc=0/local=1/wall=2, offset (secs), suffix ]
// e.g. [ 1987, 2006, 4, 3, 0, 0, 2, 0, 2, 3600, 'BST' ]

var getRule = function ( rules, offset, datetime, isUTC, recurse ) {
    var l = rules.length,
        year = datetime.getUTCFullYear(),
        rule, ruleDate, ruleIsUTC, ruleInEffect = null, dateInEffect,
        month, date, day, difference;
    while ( l-- ) {
        rule = rules[l];
        // Sorted by end year. So if ends before this date, no further rules
        // can apply.
        if ( rule[1] < year ) {
            break;
        }
        // If starts on or before this date, the rule applies.
        if ( rule[0] <= year ) {
            // Create the date object representing the transition point.
            month = rule[2];
            // 0 => last day of the month
            date = rule[3] || Date.getDaysInMonth( month, year );
            ruleDate = new Date(Date.UTC(
                year, month, date, rule[5], rule[6], rule[7]
            ));

            // Adjust to nearest +/- day of the week if specified
            if ( day = rule[4] ) {
                // +/- => (on or after/on or before) current date.
                // abs( value ) => 1=SUN,2=MON,... etc.
                difference =
                    ( Math.abs( day ) - ruleDate.getUTCDay() + 6 ) % 7;
                if ( difference ) {
                    ruleDate.add(
                        day < 1 ? difference - 7 : difference
                    );
                }
            }

            // Now match up timezones
            ruleIsUTC = !rule[8];
            if ( ruleIsUTC !== isUTC ) {
                ruleDate.add(
                    ( ruleIsUTC ? 1 : -1 ) * offset, 'second'
                );
                // We need to add the offset of the previous rule. Sigh.
                // The maximum time offset from a rule is 2 hours. So if within
                // 3 hours, find the rule for the previous day.
                if ( rule[8] === 2 &&
                    Math.abs( ruleDate - datetime ) <= 3 * 60 * 60 * 1000 ) {
                    ruleDate.add(
                        ( ruleIsUTC ? 1 : -1 ) *
                        getRule(
                            rules,
                            offset,
                            new Date( datetime - 86400000 ),
                            isUTC,
                            true
                        )[9], 'second'
                    );
                }
            }

            // If we're converting from UTC, the time could be valid twice
            // or invalid. We should pick the rule to follow RFC5545 guidance:
            // Presume the earlier rule is still in effect in both cases
            if ( !isUTC ) {
                ruleDate.add( rule[9], 'second' );
                if ( Math.abs( ruleDate - datetime ) <= 3 * 60 * 60 * 1000 ) {
                    ruleDate.add(
                        getRule(
                            rules,
                            offset,
                            new Date( datetime - 86400000 ),
                            isUTC,
                            true
                        )[9], 'second'
                    );
                }
            }

            // Does this replace a previously found rule?
            if ( ruleDate <= datetime &&
                    ( !dateInEffect || ruleDate > dateInEffect ) ) {
                ruleInEffect = rule;
                dateInEffect = ruleDate;
            }
        }
    }
    if ( !ruleInEffect && recurse ) {
        return getRule( rules, offset, new Date(Date.UTC(
            year - 1, 11, 31, 12, 0, 0
        )), isUTC, false );
    }
    return ruleInEffect;
};

var TimeZone = NS.Class({
    init: function ( mixin ) {
        NS.extend( this, mixin );
    },

    convert: function ( date, toTimeZone ) {
        var period = getPeriod( this.periods, date ),
            offset = period[1],
            rule = getRule( TimeZone.rules[ period[2] ] || [],
                offset, date, toTimeZone, true );
        if ( rule ) {
            offset += rule[9];
        }
        if ( !toTimeZone ) {
            offset = -offset;
        }
        return new Date( +date + offset * 1000 );
    },
    convertDateToUTC: function ( date ) {
        return this.convert( date, false );
    },
    convertDateToTimeZone: function ( date ) {
        return this.convert( date, true );
    },
    getSuffix: function ( date ) {
        var period = getPeriod( this.periods, date, false ),
            offset = period[1],
            rule = getRule( TimeZone.rules[ period[2] ],
                offset, date, false, true ),
            suffix = period[3],
            slashIndex = suffix.indexOf( '/' );
        // If there's a slash, e.g. "GMT/BST", presume first if no time offset,
        // second if time offset.
        if ( rule && slashIndex > - 1 ) {
            suffix = rule[9] ?
                suffix.slice( slashIndex + 1 ) : suffix.slice( 0, slashIndex );
            rule = null;
        }
        return suffix.format( rule ? rule[10] : '' );
    },
    toJSON: function () {
        return this.id;
    }
});

TimeZone.fromJSON = function ( id ) {
    return TimeZone[ id ] || TimeZone.UTC;
};

TimeZone.isEqual = function ( a, b ) {
    return a.id === b.id;
};

TimeZone.rules = {
    '-': []
};
TimeZone.areas = {};

TimeZone.load = function ( json ) {
    var zones = json.zones,
        link = json.link,
        areas = TimeZone.areas,
        timeZone, id, parts, area, i, l;

    for ( id in zones ) {
        timeZone = new TimeZone({
            id: id,
            periods: zones[ id ]
        });
        TimeZone[ id ] = timeZone;

        area = areas;
        parts = id.replace( /_/g, ' ' ).split( '/' );
        l = parts.length - 1;
        for ( i = 0; i < l; i += 1 ) {
            area = area[ parts[i] ] || ( area[ parts[i] ] = {} );
        }
        area[ parts[l] ] = timeZone;
    }
    for ( id in link ) {
        timeZone = new TimeZone({
            id: id,
            periods: zones[ link[ id ] ]
        });
        TimeZone[ id ] = timeZone;

        area = areas;
        parts = id.replace( /_/g, ' ' ).split( '/' );
        l = parts.length - 1;
        for ( i = 0; i < l; i += 1 ) {
            area = area[ parts[i] ] || ( area[ parts[i] ] = {} );
        }
        area[ parts[l] ] = timeZone;
    }
    NS.extend( TimeZone.rules, json.rules );
};

NS.TimeZone = TimeZone;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: GestureManager.js                                                    \\
// Module: Touch                                                              \\
// Requires: View                                                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS ) {

var GestureManager = new NS.Object({

    _gestures: [],

    register: function ( gesture ) {
        this._gestures.push( gesture );
    },

    deregister: function ( gesture ) {
        this._gestures.erase( gesture );
    },

    isMouseDown: false,

    fire: function ( type, event ) {
        if ( /^touch/.test( type ) ) {
            var gestures = this._gestures,
                l = gestures.length;
            type = type.slice( 5 );
            while ( l-- ) {
                gestures[l][ type ]( event );
            }
        }
        if ( !event.button ) {
            if ( type === 'mousedown' ) {
                this.set( 'isMouseDown', true );
            }
            if ( type === 'mouseup' ) {
                this.set( 'isMouseDown', false );
            }
        }
        return false;
    }
});

NS.ViewEventsController.addEventTarget( GestureManager, 30 );

NS.GestureManager = GestureManager;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Gesture.js                                                           \\
// Module: Touch                                                              \\
// Requires: GestureManager.js                                                \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

NS.Gesture = NS.Class({
    init: function ( mixin ) {
        NS.extend( this, mixin );
        NS.GestureManager.register( this );
    },
    destroy: function () {
        NS.GestureManager.deregister( this );
    },
    cancel: function () {},
    start: function () {},
    move: function () {},
    end: function () {}
});

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Tap.js                                                               \\
// Module: Touch                                                              \\
// Requires: Gesture.js                                                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/*  We can't just call preventDefault on touch(start|move), as this would
    prevent scrolling and also prevent links we want to act as normal from
    working. So we use this hack instead to capture the subsequent click and
    remove it from the app's existence.
*/
var MouseEventRemover = NS.Class({
    init: function ( target, defaultPrevented ) {
        this.target = target;
        this.stop = defaultPrevented;
        this.time = Date.now();
        NS.ViewEventsController.addEventTarget( this, 40 );
    },
    fire: function ( type, event ) {
        var isClick = ( type === 'click' ) && !event.originalType,
            isMouse = isClick || /^mouse/.test( type );
        if ( type === 'touchstart' || Date.now() - this.time > 1000 ) {
            NS.ViewEventsController.removeEventTarget( this );
            return false;
        }
        if ( isMouse && ( this.stop || event.target !== this.target ) ) {
            event.preventDefault();
        }
        return isMouse;
    }
});

var TapEvent = NS.Class({

    Extends: NS.Event,

    originalType: 'tap'
});

var TrackedTouch = function ( x, y, time, target ) {
    this.x = x;
    this.y = y;
    this.time = time;
    var activeEls = this.activeEls = [];
    do {
        if ( /^(?:A|BUTTON|INPUT|LABEL)$/.test( target.nodeName ) ) {
            activeEls.push( target );
            NS.Element.addClass( target, 'tap-active' );
        }
    } while ( target = target.parentNode );
};

TrackedTouch.prototype.done  = function () {
    var activeEls = this.activeEls,
        i, l;
    for ( i = 0, l = activeEls.length; i < l; i += 1 ) {
        NS.Element.removeClass( activeEls[i], 'tap-active' );
    }
};

/*  A tap is defined as a touch which:

    * Lasts less than 200ms.
    * Moves less than 5px from the initial touch point.

    There may be other touches occurring at the same time (e.g. you could be
    holding one button and tap another; the tap gesture will still be
    recognised).
*/
NS.Tap = new NS.Gesture({

    _tracking: {},

    cancel: function () {
        var tracking = this._tracking,
            id;
        for ( id in tracking ) {
            tracking[ id ].done();
        }
        this._tracking = {};
    },

    start: function ( event ) {
        var touches = event.changedTouches,
            tracking = this._tracking,
            now = Date.now(),
            i, l, touch, id;
        for ( i = 0, l = touches.length; i < l; i += 1 ) {
            touch = touches[i];
            id = touch.identifier;
            if ( !tracking[ id ] ) {
                tracking[ id ] = new TrackedTouch(
                    touch.screenX, touch.screenY, now, touch.target );
            }
        }
    },

    move: function ( event ) {
        var touches = event.changedTouches,
            tracking = this._tracking,
            i, l, touch, id, trackedTouch, deltaX, deltaY;
        for ( i = 0, l = touches.length; i < l; i += 1 ) {
            touch = touches[i];
            id = touch.identifier;
            trackedTouch = tracking[ id ];
            if ( trackedTouch ) {
                deltaX = touch.screenX - trackedTouch.x;
                deltaY = touch.screenY - trackedTouch.y;
                if ( deltaX * deltaX + deltaY * deltaY > 25 ) {
                    trackedTouch.done();
                    delete tracking[ id ];
                }
            }
        }
    },

    end: function ( event ) {
        var touches = event.changedTouches,
            tracking = this._tracking,
            now = Date.now(),
            i, l, touch, id, trackedTouch, target, tapEvent, clickEvent,
            nodeName,
            ViewEventsController = NS.ViewEventsController;
        for ( i = 0, l = touches.length; i < l; i += 1 ) {
            touch = touches[i];
            id = touch.identifier;
            trackedTouch = tracking[ id ];
            if ( trackedTouch ) {
                if ( now - trackedTouch.time < 200 ) {
                    target = touch.target;
                    tapEvent = new TapEvent( 'tap', target );
                    ViewEventsController.handleEvent( tapEvent );
                    clickEvent = new TapEvent( 'click', target );
                    clickEvent.defaultPrevented = tapEvent.defaultPrevented;
                    ViewEventsController.handleEvent( clickEvent );
                    // The tap could trigger a UI change. When the click event
                    // is fired 300ms later, if there is now an input under the
                    // area the touch took place, in iOS the keyboard will
                    // appear, even though the preventDefault on the click event
                    // stops it actually being focussed. Calling preventDefault
                    // on the touchend event stops this happening, however we
                    // must not do this if the user actually taps an input!
                    nodeName = target.nodeName;
                    if ( nodeName !== 'INPUT' && nodeName !== 'TEXTAREA' &&
                            nodeName !== 'SELECT' ) {
                        event.preventDefault();
                    }
                    new MouseEventRemover( target, clickEvent.defaultPrevented );
                }
                trackedTouch.done();
                delete tracking[ id ];
            }
        }
    }
});

}( O ) );


// -------------------------------------------------------------------------- \\
// File: Hold.js                                                              \\
// Module: Touch                                                              \\
// Requires: Gesture.js, Tap.js                                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var HoldEvent = NS.Class({

    Extends: NS.Event,

    init: function ( touch ) {
        HoldEvent.parent.init.call( this, 'hold', touch.target );
        this.touch = touch;
    }
});

var fireHoldEvent = function () {
    if ( !this._ignore ) {
        NS.ViewEventsController.handleEvent(
            new HoldEvent( this.touch )
        );
    }
};

var TrackedTouch = function ( touch ) {
    this.touch = touch;
    this.x = touch.screenX;
    this.y = touch.screenY;
    this.target = touch.target;
    this._ignore = false;
    NS.RunLoop.invokeAfterDelay( fireHoldEvent, 750, this );
};

TrackedTouch.prototype.done = function () {
    this._ignore = true;
};

/*  A hold is defined as a touch which:

    * Lasts at least 750ms.
    * Moves less than 5px from the initial touch point.
*/
NS.Hold = new NS.Gesture({

    _tracking: {},

    cancel: NS.Tap.cancel,

    start: function ( event ) {
        var touches = event.changedTouches,
            tracking = this._tracking,
            i, l, touch, id;
        for ( i = 0, l = touches.length; i < l; i += 1 ) {
            touch = touches[i];
            id = touch.identifier;
            if ( !tracking[ id ] ) {
                tracking[ id ] = new TrackedTouch( touch );
            }
        }
    },

    move: NS.Tap.move,

    end: function ( event ) {
        var touches = event.changedTouches,
            tracking = this._tracking,
            i, l, touch, id, trackedTouch;
        for ( i = 0, l = touches.length; i < l; i += 1 ) {
            touch = touches[i];
            id = touch.identifier;
            trackedTouch = tracking[ id ];
            if ( trackedTouch ) {
                trackedTouch.done();
                delete tracking[ id ];
            }
        }
    }
});

}( O ) );



// -------------------------------------------------------------------------- \\
// File: ModalEventHandler.js                                                 \\
// Module: PanelViews                                                         \\
// Requires: Core, Foundation, DOM, View                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var ModalEventHandler = NS.Class({

    Extends: NS.Object,

    init: function ( mixin ) {
        ModalEventHandler.parent.init.call( this, mixin );
        this._seenMouseDown = false;
    },

    inView: function ( event ) {
        var targetView = event.targetView,
            view = this.get( 'view' );
        while ( targetView && targetView !== view ) {
            targetView = targetView.get( 'parentView' );
        }
        return !!targetView;
    },

    // If a user clicks outside the menu we want to close it. But we don't want
    // the mousedown/mouseup/click events to propagate to what's below. The
    // events fire in that order, and not all are guaranteed to fire (the user
    // could mousedown and drag their mouse out of the window before releasing
    // it or vica versa. If there is a drag in between mousedown and mouseup,
    // the click event won't fire).
    //
    // The safest to hide on is click, as we know there are no more events from
    // this user interaction which we need to capture, and it also means the
    // user has clicked and released outside the pop over; a decent indication
    // we should close it. However, if the pop over was triggered on mousedown
    // we may still see a mouseup and a click event from this initial user
    // interaction, but these musn't hide the view. Therefore, we make sure
    // we've seen at least one mousedown event after the popOver view shows
    // before hiding on click.
    handleMouse: function ( event ) {
        var type = event.type,
            view;
        if ( !event.seenByModal && !this.inView( event ) ) {
            event.stopPropagation();
            if ( type === 'mousedown' || type === 'tap' ) {
                this._seenMouseDown = true;
            } else if ( type === 'click' ) {
                event.preventDefault();
                if ( this._seenMouseDown ) {
                    view = this.get( 'view' );
                    if ( view.clickedOutside ) {
                        view.clickedOutside( event );
                    }
                }
            }
        }
        event.seenByModal = true;
    }.on( 'click', 'mousedown', 'mouseup', 'tap' ),

    // If the user clicks on a scroll bar to scroll (I know, who does that
    // these days right?), we don't want to count that as a click. So cancel
    // the seen mousedown on scroll events.
    handleScroll: function () {
        this._seenMouseDown = false;
    }.on( 'scroll' ),

    handleKeys: function ( event ) {
        if ( !event.seenByModal && !this.inView( event ) ) {
            event.stopPropagation();
            // View may be interested in key events:
            var view = this.get( 'view' );
            if ( view.keyOutside ) {
                view.keyOutside( event );
            }
        }
        event.seenByModal = true;
    }.on( 'keypress', 'keydown', 'keyup' ),

    handleTouch: function ( event ) {
        if ( !event.seenByModal && !this.inView( event ) ) {
            event.preventDefault();
            event.stopPropagation();
        }
        event.seenByModal = true;
    }.on( 'touchstart' )
});

NS.ModalEventHandler = ModalEventHandler;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: PopOverView.js                                                       \\
// Module: PanelViews                                                         \\
// Requires: Core, Foundation, DOM, View                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var PopOverView = NS.Class({

    Extends: NS.View,

    className: 'v-PopOver',

    positioning: 'absolute',

    isVisible: false,
    parentPopOverView: null,

    /*
        Options
        - view -> The view to append to the pop over
        - alignWithView -> the view to align to
        - atNode -> the node within the view to align to
        - positionToThe -> 'bottom'/'top'/'left'/'right'
        - alignEdge -> 'left'/'centre'/'right'/'top'/'middle'/'bottom'
        - inParent -> The view to insert the pop over in (optional)
        - showCallout -> true/false
        - offsetLeft
        - offsetTop
        - onHide: fn
    */
    show: function ( options ) {
        if ( options.alignWithView === this ) {
            return this.get( 'subPopOverView' ).show( options );
        }
        this.hide();

        this._options = options;

        // Set layout and insert in the right place
        var eventHandler = this.get( 'eventHandler' ),
            view = options.view,
            alignWithView = options.alignWithView,
            atNode = options.atNode || alignWithView.get( 'layer' ),
            atNodeWidth = atNode.offsetWidth,
            atNodeHeight = atNode.offsetHeight,
            positionToThe = options.positionToThe || 'bottom',
            alignEdge = options.alignEdge || 'left',
            parent = options.inParent,
            deltaLeft = 0,
            deltaTop = 0,
            layout, layer,
            Element = NS.Element,
            el = Element.create,
            RootView = NS.RootView,
            ScrollView = NS.ScrollView,
            prop;

        // Want nearest parent scroll view (or root view if none).
        // Special case parent == parent pop-over view.
        if ( !parent ) {
            parent = options.atNode ?
                alignWithView : alignWithView.get( 'parentView' );
            while ( !( parent instanceof RootView ) &&
                    !( parent instanceof ScrollView ) &&
                    !( parent instanceof PopOverView ) ) {
                parent = parent.get( 'parentView' );
            }
        }

        // Now find out our offsets;
        layout = Element.getPosition( atNode, parent instanceof ScrollView ?
            parent.get( 'scrollLayer' ) : parent.get( 'layer' ) );

        switch ( positionToThe ) {
        case 'right':
            layout.left += atNodeWidth;
            /* falls through */
        case 'left':
            switch ( alignEdge ) {
            // case 'top':
            //    break; // nothing to do
            case 'middle':
                atNodeHeight = atNodeHeight >> 1;
                /* falls through */
            case 'bottom':
                layout.top += atNodeHeight;
                break;
            }
            break;
        case 'bottom':
            layout.top += atNodeHeight;
            /* falls through */
        case 'top':
            switch ( alignEdge ) {
            // case 'left':
            //     break; // nothing to do
            case 'centre':
                atNodeWidth = atNodeWidth >> 1;
                /* falls through */
            case 'right':
                layout.left += atNodeWidth;
                break;
            }
            break;
        }

        layout.top += options.offsetTop || 0;
        layout.left += options.offsetLeft || 0;

        // Round values to prevent buggy callout rendering.
        for ( prop in layout ) {
            layout[ prop ] = Math.round( layout[prop] );
        }

        // Set layout
        this.set( 'layout', layout );

        // Insert view
        this.insertView( view );
        this.render();

        // Callout
        layer = this.get( 'layer' );
        if ( options.showCallout ) {
            layer.appendChild(
                el( 'b', {
                    className: 'v-PopOver-callout' +
                        ' v-PopOver-callout--' + positionToThe.charAt( 0 ) +
                        ' v-PopOver-callout--' + alignEdge
                }, [
                    this._callout = el( 'b', {
                        className: 'v-PopOver-triangle' +
                            ' v-PopOver-triangle--' + positionToThe.charAt( 0 )
                    })
                ])
            );
        }

        // Insert into parent.
        parent.insertView( this );

        // Adjust positioning
        switch ( positionToThe ) {
        case 'left':
            deltaLeft -= layer.offsetWidth;
            /* falls through */
        case 'right':
            switch ( alignEdge ) {
            // case 'top':
            //    break; // nothing to do
            case 'middle':
                deltaTop -= layer.offsetHeight >> 1;
                break;
            case 'bottom':
                deltaTop -= layer.offsetHeight;
                break;
            }
            break;
        case 'top':
            deltaTop -= layer.offsetHeight;
            /* falls through */
        case 'bottom':
            switch ( alignEdge ) {
            // case 'left':
            //     break; // nothing to do
            case 'centre':
                deltaLeft -= layer.offsetWidth >> 1;
                break;
            case 'right':
                deltaLeft -= layer.offsetWidth;
                break;
            }
            break;
        }

        this.adjustPosition( deltaLeft, deltaTop );

        if ( eventHandler ) {
            NS.ViewEventsController.addEventTarget( eventHandler, 10 );
        }
        this.set( 'isVisible', true );

        return this;
    },

    adjustPosition: function ( deltaLeft, deltaTop ) {
        var Element = NS.Element,
            parent = this.get( 'parentView' ),
            layer = this.get( 'layer' ),
            layout = this.get( 'layout' ),
            positionToThe = this._options.positionToThe || 'bottom',
            callout = this._callout,
            calloutDelta = 0,
            calloutIsAtTopOrBottom =
                ( positionToThe === 'top' || positionToThe === 'bottom' ),
            position, gap;

        if ( !deltaLeft ) { deltaLeft = 0; }
        if ( !deltaTop ) { deltaTop = 0; }

        // Check not run off screen.
        if ( parent instanceof PopOverView ) {
            parent = parent.getParent( NS.ScrollView ) ||
                parent.getParent( NS.RootView );
        }
        position = Element.getPosition( layer, parent.get( 'layer' ) );

        // Check right edge
        if ( !parent.get( 'showScrollbarX' ) ) {
            gap = parent.get( 'pxWidth' ) - position.left - deltaLeft -
                layer.offsetWidth;
            // If gap is negative, move the view.
            if ( gap < 0 ) {
                deltaLeft += gap;
                deltaLeft -= 10;
                if ( callout && calloutIsAtTopOrBottom ) {
                    calloutDelta += gap;
                    calloutDelta -= 10;
                }
            }
        }

        // Check left edge
        gap = position.left + deltaLeft;
        if ( gap < 0 ) {
            deltaLeft -= gap;
            deltaLeft += 10;
            if ( callout && calloutIsAtTopOrBottom ) {
                calloutDelta -= gap;
                calloutDelta += 10;
            }
        }

        // Check bottom edge
        if ( !parent.get( 'showScrollbarY' ) ) {
            gap = parent.get( 'pxHeight' )  - position.top - deltaTop -
                layer.offsetHeight;
            if ( gap < 0 ) {
                deltaTop += gap;
                deltaTop -= 10;
                if ( callout && !calloutIsAtTopOrBottom ) {
                    calloutDelta += gap;
                    calloutDelta -= 10;
                }
            }
        }

        // Check top edge
        gap = position.top + deltaTop;
        if ( gap < 0 ) {
            deltaTop -= gap;
            deltaTop += 10;
            if ( callout && !calloutIsAtTopOrBottom ) {
                calloutDelta -= gap;
                calloutDelta += 10;
            }
        }

        if ( deltaLeft || deltaTop ) {
            // Redraw immediately to prevent "flashing"
            this.set( 'layout', {
                top: layout.top + deltaTop,
                left: layout.left + deltaLeft
            }).redraw();
        }
        if ( calloutDelta ) {
            Element.setStyle( callout,
                calloutIsAtTopOrBottom ? 'left' : 'top',
                -calloutDelta + 'px'
            );
        }
    },

    didLeaveDocument: function () {
        PopOverView.parent.didLeaveDocument.call( this );
        this.hide();
        return this;
    },

    hide: function () {
        if ( this.get( 'isVisible' ) ) {
            var subPopOverView = this.hasSubView() ?
                    this.get( 'subPopOverView' ) : null,
                eventHandler = this.get( 'eventHandler' ),
                options = this._options,
                onHide, view, layer;
            if ( subPopOverView ) {
                subPopOverView.hide();
            }
            this.set( 'isVisible', false );
            view = this.get( 'childViews' )[0];
            this.detach();
            this.removeView( view );
            if ( options.showCallout ) {
                layer = this.get( 'layer' );
                layer.removeChild( layer.firstChild );
                this._callout = null;
            }
            if ( eventHandler ) {
                NS.ViewEventsController.removeEventTarget( eventHandler );
                eventHandler._seenMouseDown = false;
            }
            this._options = null;
            if ( onHide = options.onHide ) {
                onHide( options, this );
            }
        }
        return this;
    },

    hasSubView: function () {
        return !!NS.meta( this ).cache.subPopOverView &&
            this.get( 'subPopOverView' ).get( 'isVisible' );
    },

    subPopOverView: function () {
        return new NS.PopOverView({ parentPopOverView: this });
    }.property(),

    eventHandler: function () {
        return this.get( 'parentPopOverView' ) ?
            null : new NS.ModalEventHandler({ view: this });
    }.property(),

    clickedOutside: function () {
        this.hide();
    },

    keyOutside: function ( event ) {
        var view = this;
        while ( view.hasSubView() ) {
            view = view.get( 'subPopOverView' );
        }
        view.get( 'childViews' )[0].fire( event.type, event );
        if ( event.type === 'keydown' ) {
            view.closeOnEsc( event );
        }
    },

    closeOnEsc: function ( event ) {
        if ( NS.DOMEvent.lookupKey( event ) === 'esc' ) {
            this.hide();
        }
    }.on( 'keydown' ),

    stopEvents: function ( event ) {
        event.stopPropagation();
    }.on( 'click', 'mousedown', 'mouseup',
        'keypress', 'keydown', 'keyup', 'tap' )
});

NS.PopOverView = PopOverView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: AbstractControlView.js                                               \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

/**
    Class: O.AbstractControlView

    Extends: O.View

    The superclass for most DOM-control view classes. This is an abstract class
    and should not be instantiated directly; it is only intended to be
    subclassed.
*/
var AbstractControlView = NS.Class({

    Extends: NS.View,

    /**
        Property: O.AbstractControlView#isDisabled
        Type: Boolean
        Default: false

        Is the control disabled?
    */
    isDisabled: false,

    /**
        Property: O.AbstractControlView#isFocussed
        Type: Boolean

        Represents whether the control currently has focus or not.
    */
    isFocussed: false,

    /**
        Property: O.AbstractControlView#label
        Type: String|Element|null
        Default: ''

        A label for the control, to be displayed next to it.
    */
    label: '',

    /**
        Property: O.AbstractControlView#name
        Type: String|undefined
        Default: undefined

        If set, this will be the name attribute of the control.
    */
    name: undefined,

    /**
        Property: O.AbstractControlView#value
        Type: *
        Default: false

        The value represented by this control, for example true/false if a
        checkbox is checked/unchecked, or the text input into a textarea.
    */
    value: false,

    /**
        Property: O.AbstractControlView#tabIndex
        Type: Number|undefined
        Default: undefined

        If set, this will become the tab index for the control.
    */
    tabIndex: undefined,

    /**
        Property: O.AbstractControlView#shortcut
        Type: String
        Default: ''

        If set, this will be registered as the keyboard shortcut to activate the
        control when it is in the document.
    */
    shortcut: '',

    /**
        Property: O.AbstractControlView#tooltip
        Type: String
        Default: '' or 'Shortcut: <shortcut>'

        A tooltip to show when the mouse hovers over the view. Defaults to
        informing the user of the keyboard shortcut for the control, if set.
    */
    tooltip: function () {
        var shortcut = this.get( 'shortcut' );
        return shortcut ?
            NS.loc( 'Shortcut: [_1]',
                shortcut
                    .split( ' ' )
                    .map( NS.formatKeyForPlatform )
                    .join( ' ' + NS.loc( 'or' ) + ' ' )
            ) : '';
    }.property( 'shortcut' ),

    /**
        Method: O.AbstractControlView#didEnterDocument

        Overridden to add keyboard shortcuts.
        See <O.View#didEnterDocument>.
    */
    didEnterDocument: function () {
        var shortcut = this.get( 'shortcut' );
        if ( shortcut ) {
            shortcut.split( ' ' ).forEach( function ( key ) {
                NS.ViewEventsController.kbShortcuts
                    .register( key, this, 'activate' );
            }, this );
        }
        return AbstractControlView.parent.didEnterDocument.call( this );
    },

    /**
        Method: O.AbstractControlView#didEnterDocument

        Overridden to remove keyboard shortcuts.
        See <O.View#didEnterDocument>.
    */
    willLeaveDocument: function () {
        var shortcut = this.get( 'shortcut' );
        if ( shortcut ) {
            shortcut.split( ' ' ).forEach( function ( key ) {
                NS.ViewEventsController.kbShortcuts
                    .deregister( key, this, 'activate' );
            }, this );
        }
        return AbstractControlView.parent.willLeaveDocument.call(
            this );
    },

    /**
        Property: O.AbstractControlView#layerTag
        Type: String
        Default: 'label'

        Overrides default in <O.View#layerTag>.
   */
    layerTag: 'label',

    /**
        Property (private): O.AbstractControlView#_domControl
        Type: Element|null

        A reference to the DOM control managed by the view.
    */
    _domControl: null,

    /**
        Property (private): O.AbstractControlView#_domLabel
        Type: Element|null

        A reference to the DOM element containing the label for the view.
    */
    _domLabel: null,

    /**
        Method: O.AbstractControlView#draw

        Overridden to set properties and add label. See <O.View#draw>.
    */
    draw: function ( layer, Element, el ) {
        var control = this._domControl,
            name = this.get( 'name' ),
            shortcut = this.get( 'shortcut' ),
            tabIndex = this.get( 'tabIndex' );

        if ( !control.id ) {
            control.id = this.get( 'id' ) + '-input';
        }
        control.disabled = this.get( 'isDisabled' );

        if ( name !== undefined ) {
            control.name = name;
        }

        if ( tabIndex !== undefined ) {
            control.tabIndex = tabIndex;
        }

        if ( shortcut && ( /^\w$/.test( shortcut ) ) ) {
            control.accessKey = shortcut;
        }

        layer.title = this.get( 'tooltip' );
        return this._domLabel = el( 'span.label', [ this.get( 'label' ) ] );
    },

    // --- Keep render in sync with state ---

    abstractControlNeedsRedraw: function ( self, property, oldValue ) {
       return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'isDisabled', 'label', 'name', 'tooltip', 'tabIndex' ),

    /**
        Method: O.AbstractControlView#redrawIsDisabled

        Updates the disabled attribute on the DOM control to match the
        isDisabled property of the view.
    */
    redrawIsDisabled: function () {
        this._domControl.disabled = this.get( 'isDisabled' );
    },

    /**
        Method: O.AbstractControlView#redrawLabel

        Updates the DOM label to match the label property of the view.
    */
    redrawLabel: function () {
        var label = this._domLabel,
            child;
        while ( child = label.firstChild ) {
            label.removeChild( child );
        }
        NS.Element.appendChildren( label, [
            this.get( 'label' )
        ]);
    },

    /**
        Method: O.AbstractControlView#redrawName

        Updates the name attribute on the DOM control to match the name
        property of the view.
    */
    redrawName: function () {
        this._domControl.name = this.get( 'name' );
    },

    /**
        Method: O.AbstractControlView#redrawTooltip

        Parameters:
            layer - {Element} The DOM layer for the view.

        Updates the title attribute on the DOM layer to match the tooltip
        property of the view.
    */
    redrawTooltip: function ( layer ) {
        layer.title = this.get( 'tooltip' );
    },

    /**
        Method: O.AbstractControlView#redrawTabIndex

        Updates the tabIndex attribute on the DOM control to match the tabIndex
        property of the view.
    */
    redrawTabIndex: function () {
        this._domControl.tabIndex = this.get( 'tabIndex' );
    },

    // --- Focus ---

    /**
        Method: O.AbstractControlView#focus

        Focusses the control.

        Returns:
            {O.AbstractControlView} Returns self.
    */
    focus: function () {
        if ( this.get( 'isInDocument' ) ) {
            this._domControl.focus();
            // Fire event synchronously.
            if ( !this.get( 'isFocussed' ) ) {
                this.fire( 'focus' );
            }
        }
        return this;
    },

    /**
        Method: O.AbstractControlView#blur

        Removes focus from the control.

        Returns:
            {O.AbstractControlView} Returns self.
    */
    blur: function () {
        if ( this.get( 'isInDocument' ) ) {
            this._domControl.blur();
            // Fire event synchronously.
            if ( this.get( 'isFocussed' ) ) {
                this.fire( 'blur' );
            }
        }
        return this;
    },

    /**
        Method (private): O.AbstractControlView#_updateIsFocussed

        Updates the <#isFocussed> property.

        Parameters:
            event - {Event} The focus event.
    */
    _updateIsFocussed: function ( event ) {
        this.set( 'isFocussed', event.type === 'focus' );
    }.on( 'focus', 'blur' ),

    // --- Activate ---

    /**
        Method: O.AbstractControlView#activate

        An abstract method to be overridden by subclasses. This is the action
        performed when the control is activated, either by being clicked on or
        via a keyboard shortcut.
    */
    activate: function () {}

});

NS.AbstractControlView = AbstractControlView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ButtonView.js                                                        \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, AbstractControlView.js              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.ButtonView

    Extends: O.AbstractControlView

    A ButtonView represents an interactive rectangle in your user interface
    which the user can click/tap to perform an action. The ButtonView uses a
    <button> element in the DOM by default. If the action being perfomed is
    actually a navigation and just shows/hides content and does not change any
    state, semantically you should change the layer tag to an <a>.

    ### Using O.ButtonView ###

    The most common way to use O.ButtonView is to create an instance as part of
    the <O.View#draw method of your view class. For example:

        var Element = O.Element,
            el = Element.create;

        Element.appendChildren( layer, [
            el( 'h1', [
                'Which pill will you take?'
            ]),
            el( 'div.actions', [
                new O.ButtonView({
                    type: 'v-Button--destructive v-Button--size13',
                    icon: 'redpill',
                    isDisabled: O.bind( controller, 'isNeo' ),
                    label: 'The Red Pill',
                    target: controller,
                    method: 'abort'
                }),
                new O.ButtonView({
                    type: 'v-Button--constructive v-Button--size13',
                    icon: 'bluepill',
                    label: 'The Blue Pill',
                    target: controller,
                    method: 'proceed'
                })
            ])
        ]);

    new O.ButtonView

    ### Styling O.ButtonView ###

    The underlying DOM structure is:

        <button class="ButtonView ${view.type}">
            <i class="${view.icon}"></i>
            <span>${view.label}</span>
        </button>

    If there is no icon property set, the <i> will have a class of 'hidden'
    instead. The icon can be drawn as a background to the empty <i> element.
*/
var ButtonView = NS.Class({

    Extends: NS.AbstractControlView,

    /**
        Property: O.ButtonView#isActive
        Type: Boolean
        Default: false

        If the button is a toggle (like in the case of <O.MenuButtonView>, where
        the menu is either visible or not), this property should be set to true
        when in the active state, and false when not. This provides a CSS hook
        for drawing the correct style to represent the button state.

        <O.MenuButtonView> instances will automatically set this property
        correctly, but if you subclass O.ButtonView yourself in a similar way,
        be sure to set this when the state changes.
    */
    isActive: false,

    /**
        Property: O.ButtonView#type
        Type: String
        Default: ''

        A space-separated list of CSS classnames to give the layer in the DOM,
        irrespective of state.
    */
    type: '',

    /**
        Property: O.ButtonView#type
        Type: String
        Default: ''

        Set to the name of the icon to use, if any, for the button. See the
        general notes on using <O.ButtonView> for more information.
    */
    icon: '',

    /**
        Property: O.ButtonView#tabIndex
        Type: Number
        Default: -1

        Overrides default in <O.AbstractControlView#tabIndex>.
    */
    tabIndex: -1,

    // --- Render ---

    /**
        Property: O.ButtonView#layerTag
        Type: String
        Default: 'button'

        Overrides default in <O.View#layerTag>.
    */
    layerTag: 'button',

    /**
        Property: O.ButtonView#className
        Type: String

        Overrides default in <O.View#className>. The layer will always have the
        class "ButtonView" plus any classes listed in the <O.ButtonView#type>
        property. In addition, it may have the following classes depending on
        the state:

        hasIcon     - If the view has an icon property set.
        hasShortcut - If the view has a shortcut property set.
        active      - If the view's isActive property is true.
        disabled    - If the view's isDisabled property is true.
    */
    className: function () {
        var type = this.get( 'type' );
        return 'v-Button' +
            ( type ? ' ' + type : '' ) +
            ( this.get( 'icon' ) ? ' v-Button--hasIcon' : '' ) +
            ( this.get( 'shortcut' ) ? ' v-Button--hasShortcut' : '' ) +
            ( this.get( 'isActive' ) ? ' is-active' : '' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' );
    }.property( 'type', 'icon', 'shortcut', 'isActive', 'isDisabled' ),

    /**
        Method: O.ButtonView#draw

        Overridden to draw view. See <O.View#draw>. For DOM structure, see
        general <O.ButtonView> notes.
    */
    draw: function ( layer, Element, el ) {
        var icon = this.get( 'icon' );
        this._domControl = layer;
        return [
            el( 'i', {
                className: icon ? 'icon ' + icon : 'u-hidden'
            }),
            ButtonView.parent.draw.call( this, layer, Element, el )
        ];
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.ButtonView#buttonNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    buttonNeedsRedraw: function ( self, property, oldValue ) {
       return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'icon' ),

    /**
        Method: O.ButtonView#redrawIcon

        Updates the className of the <i> representing the button's icon.
    */
    redrawIcon: function ( layer ) {
        var icon = this.get( 'icon' );
        layer.firstChild.className = icon ? 'icon ' + icon : 'u-hidden';
    },

    // --- Activate ---

    /**
        Property: O.ButtonView#target
        Type: Object|null
        Default: null

        The object to fire an event/call a method on when the button is
        activated. If null (the default), the ButtonView instance itself will be
        used.
    */
    target: null,

    /**
        Property: O.ButtonView#action
        Type: String|null
        Default: null

        The name of the event to fire on the <#target> when the button is
        activated. Note, you should set *either* the action property or the
        <#method> property. If both are set, the method property will be
        ignored.
    */
    action: null,

    /**
        Property: O.ButtonView#method
        Type: String|null
        Default: null

        The name of the method to call on the <#target> when the button is
        activated. Note, you should set *either* the <#action> property or the
        method property. If both are set, the method property will be ignored.
    */
    method: null,

    /**
        Method: O.ButtonView#activate

        This method is called when the button is triggered, either by being
        clicked/tapped on, or via a keyboard shortcut. If the button is
        disabled, it will do nothing. Otherwise, it fires an event with the name
        given in the <#action> property on the <#target> object. Or, if no
        action is defined, calls the method named in the <#method> property on
        the object instead.

        If an event is fired, the `originView` property of the event object
        provides a reference back to the button that fired it. If a method is
        called, the ButtonView instance will be passed as the sole argument.

        It also fires an event called `button:activate` on itself.
    */
    activate: function () {
        if ( !this.get( 'isDisabled' ) ) {
            var target = this.get( 'target' ) || this,
                action;
            if ( action = this.get( 'action' ) ) {
                target.fire( action, { originView: this } );
            } else if ( action = this.get( 'method' ) ) {
                target[ action ]( this );
            }
            this.fire( 'button:activate' );
        }
    },

    // --- Keep state in sync with render ---

    /**
        Property (private): O.ButtonView#_ignoreUntil
        Type: Number

        Time before which we should not reactive.

        We want to trigger on mouseup so that the button can be used in a menu
        in a single click action. However, we also want to trigger on click for
        accessibility reasons. We don't want to trigger twice though, and at the
        time of the mouseup event there's no way to know if a click event will
        follow it. However, if a click event *is* following it, in most
        browsers, the click event will already be in the event queue, so we
        temporarily ignore clicks and put a callback function onto the end of
        the event queue to stop ignoring them. This will only run after the
        click event has fired (if there is one). The exception is Opera, where
        it gets queued before the click event. By adding a minimum 200ms delay
        we can more or less guarantee it is queued after, and it also prevents
        double click from activating the button twice, which could have
        unintended effects.
    */
    _ignoreUntil: 0,

    /**
        Method (private): O.ButtonView#_setIgnoreUntil
    */
    _setIgnoreUntil: function () {
        this._ignoreUntil = Date.now() + 200;
    },

    /**
        Method (private): O.ButtonView#_activateOnClick

        Activates the button on normal clicks.

        Parameters:
            event - {Event} The click or mouseup event.
    */
    _activateOnClick: function ( event ) {
        if ( this._ignoreUntil > Date.now() ||
                event.button || event.metaKey || event.ctrlKey ) {
            return;
        }
        if ( event.type !== 'mouseup' || this.getParent( NS.MenuView ) ) {
            this._ignoreUntil = 4102444800000; // 1st Jan 2100...
            NS.RunLoop.invokeInNextEventLoop( this._setIgnoreUntil, this );
            this.activate();
            event.preventDefault();
        }
    }.on( 'mouseup', 'click' ),

    /**
        Method (private): O.ButtonView#_activateOnEnter

        Activates the button when it has keyboard focus and the `enter` key is
        pressed.

        Parameters:
            event - {Event} The keypress event.
    */
    _activateOnEnter: function ( event ) {
        if ( NS.DOMEvent.lookupKey( event ) === 'enter' ) {
            this.activate();
            // Don't want to trigger global keyboard shortcuts
            event.stopPropagation();
        }
    }.on( 'keypress' )
});

NS.ButtonView = ButtonView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: CheckboxView.js                                                      \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, AbstractControlView.js              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.CheckboxView

    Extends: O.AbstractControlView

    A checkbox control view. The `value` property is two-way bindable,
    representing the state of the checkbox (`true` => checked).
*/
var CheckboxView = NS.Class({

    Extends: NS.AbstractControlView,

    // --- Render ---

    type: '',

    /**
        Property: O.CheckboxView#className
        Type: String
        Default: 'v-Checkbox'

        Overrides default in <O.View#className>.
    */
    className: function () {
        var type = this.get( 'type' );
        return 'v-Checkbox ' +
            ( this.get( 'value' ) ? 'is-checked' : 'is-unchecked' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' ) +
            ( type ? ' ' + type : '' );
    }.property( 'type', 'value', 'isDisabled' ),

    /**
        Method: O.CheckboxView#draw

        Overridden to draw checkbox in layer. See <O.View#draw>.
    */
    draw: function ( layer, Element, el ) {
        return [
            this._domControl = el( 'input', {
                className: 'v-Checkbox-input',
                type: 'checkbox',
                checked: this.get( 'value' )
            }),
            CheckboxView.parent.draw.call( this, layer, Element, el )
        ];
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.CheckboxView#checkboxNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    checkboxNeedsRedraw: function ( self, property, oldValue ) {
       return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'value' ),

    /**
        Method: O.CheckboxView#redrawValue

        Updates the checked status of the DOM `<input type="checkbox">` to match
        the value property of the view.
    */
    redrawValue: function () {
        this._domControl.checked = this.get( 'value' );
    },

    // --- Activate ---

    /**
        Method: O.CheckboxView#activate

        Overridden to toggle the checked status of the control. See
        <O.AbstractControlView#activate>.
    */
    activate: function () {
        if ( !this.get( 'isDisabled' ) ) {
            this.toggle( 'value' );
        }
    },

    // --- Keep state in sync with render ---

    /**
        Method: O.CheckboxView#syncBackValue

        Observes `click` and `tap` events to update the view's `value` property
        when the user toggles the checkbox.
    */
    syncBackValue: function ( event ) {
        var isTap = ( event.type === 'tap' );
        // Ignore simulated click events
        if ( ( isTap || !event.originalType ) &&
                event.targetView === this &&
                !this.get( 'isDisabled' ) ) {
            var control = this._domControl,
                value = control.checked;
            if ( isTap || event.target !== control ) {
                event.preventDefault();
                value = !value;
            }
            this.set( 'value', value );
        }
    }.on( 'click', 'tap' )
});

NS.CheckboxView = CheckboxView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: FileButtonView.js                                                    \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, ButtonView.js                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global FormData */

( function ( NS, undefined ) {

var canUseMultiple = FormData.isFake ? null : 'multiple';

/**
    Class: O.FileButtonView

    Extends: O.ButtonView

    A FileButtonView is used to allow the user to select a file (or multiple
    files) from their computer, which you can then upload to a server or, on
    modern browsers, read and manipulate directly.

    In general, FileButtonview is designed to be used just like an
    <O.ButtonView> instance, including styling.

    ### Styling O.FileButtonView ###

    The underlying DOM structure is:

        <label>
            <i class="${view.icon}"></i>
            <input type="file">
            <span>${view.label}</span>
        </label>

    If there is no icon property set, the <i> will have a class of 'hidden'
    instead. The icon can be drawn as a background to the empty <i> element.
*/
var FileButtonView = NS.Class({

    Extends: NS.ButtonView,

    /**
        Property: O.FileButtonView#acceptMultiple
        Type: Boolean
        Default: false

        Should the user be allowed to select multiple files at once (if the
        browser supports it)?
    */
    acceptMultiple: false,

    /**
        Property: O.FileButtonView#acceptOnlyTypes
        Type: String
        Default: ''

        A comma-separated list of MIME types that may be selected by the user.
        Modern browsers only (set directly as the `accept` attribute in the
        `<input>` element).
    */
    acceptOnlyTypes: '',

    // --- Render ---

    /**
        Property: O.ButtonView#layerTag
        Type: String
        Default: 'label'

        Overrides default in <O.ButtonView#layerTag>.
    */
    layerTag: 'label',

    /**
        Property: O.FileButtonView#type
        Type: String
        Default: 'v-FileButton'

        Overrides default in <O.ButtonView#type>.
    */
    type: 'v-FileButton',

    /**
        Method: O.FileButtonView#draw

        Overridden to draw view. See <O.View#draw>. For DOM structure, see
        general <O.FileButtonView> notes.
    */
    draw: function ( layer, Element, el ) {
        var icon = this.get( 'icon' );
        return [
            el( 'i', {
                className: icon ? 'icon ' + icon : 'u-hidden'
            }),
            this._domControl = el( 'input', {
                className: 'v-FileButton-input',
                type: 'file',
                accept: this.get( 'acceptOnlyTypes' ) || undefined,
                multiple: this.get( 'acceptMultiple' ) && canUseMultiple
            }),
            NS.AbstractControlView.prototype.draw
                .call( this, layer, Element, el )
        ];
    },

    // --- Activate ---

    // Remove these methods. Must be handled by the browser.
    _activateOnClick: null,
    _activateOnEnter: null,

    /**
        Method: O.FileButtonView#activate

        Opens the OS file chooser dialog.
    */
    activate: function () {
        this._domControl.click();
    },

    /**
        Method (private): O.FileButtonView#_fileWasChosen

        Parameters:
            event - {Event} The change event.

        Calls the method or fires the action on the target (see <O.ButtonView>
        for description of these), with the files as the first argument or
        `files` property on the event object.
    */
    _fileWasChosen: function ( event ) {
        var input = this._domControl,
            files, filePath,
            target, action;
        if ( event.target === input ) {
            input.parentNode.replaceChild(
                this._domControl = NS.Element.create( 'input', {
                    className: 'v-FileButton-input',
                    type: 'file',
                    disabled: this.get( 'isDisabled' ),
                    tabIndex: this.get( 'tabIndex' ),
                    accept: this.get( 'acceptOnlyTypes' ) || undefined,
                    multiple: this.get( 'acceptMultiple' ) && canUseMultiple
                }), input );
            if ( !FormData.isFake && input.files ) {
                files = Array.prototype.slice.call( input.files );
            } else {
                filePath = input.value.replace( /\\/g, '/' );
                files = [{
                    name: filePath.slice( filePath.lastIndexOf( '/' ) + 1 ),
                    size: 0,
                    type: '',
                    file: input
                }];
            }
            if ( !this.get( 'isDisabled' ) ) {
                target = this.get( 'target' ) || this;
                if ( action = this.get( 'action' ) ) {
                    target.fire( action, {
                        originView: this,
                        files: files
                    });
                } else if ( action = this.get( 'method' ) ) {
                    target[ action ]( files, this );
                }
                this.fire( 'button:activate' );
            }
        }
    }.on( 'change' )
});

NS.FileButtonView = FileButtonView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: LabelView.js                                                         \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.LabelView

    Extends: O.View

    A LabelView simply displays a string of text, and optionally has a tooltip.
    Its DOM structure is:

        <span title="${view.tooltip}">${view.value}</span>

    Although you may often want to change the layer tag (e.g. to an `h1` etc.)
*/
var LabelView = NS.Class({

    Extends: NS.View,

    /**
        Property: O.LabelView#layerTag
        Type: String
        Default: 'span'

        Overrides default in <O.View#layerTag>.
    */
    layerTag: 'span',

    /**
        Property: O.LabelView.value
        Type: String
        Default: ''

        The text to display in the view.
    */
    value: '',

    /**
        Property: O.LabelView#tooltip
        Type: String
        Default: ''

        The tooltip for the view.
    */
    tooltip: '',

    /**
        Method: O.LabelView#draw

        Overridden to draw view. See <O.View#draw>.
    */
    draw: function ( layer/*, Element, el*/ ) {
        layer.title = this.get( 'tooltip' );
        layer.textContent = this.get( 'value' );
    },

    /**
        Method: O.LabelView#labelNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    labelNeedsRedraw: function ( self, property, oldValue ) {
       return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'tooltip', 'value' ),

    /**
        Method: O.LabelView#redrawTooltip

        Parameters:
            layer - {Element} The DOM layer for the view.

        Updates the title attribute on the DOM layer to match the tooltip
        property of the view.
    */
    redrawTooltip: function ( layer ) {
        layer.title = this.get( 'tooltip' );
    },

    /**
        Method: O.LabelView#redrawValue

        Parameters:
            layer - {Element} The DOM layer for the view.

        Updates the text content of the DOM layer to match the value property of
        the view.
    */
    redrawValue: function ( layer ) {
        layer.textContent = this.get( 'value' );
    }
});

NS.LabelView = LabelView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: MenuButtonView.js                                                    \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, ButtonView.js                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.MenuButtonView

    Extends: O.ButtonView

    A MenuButtonView reveals a menu when pressed. Example usage:

        new O.MenuButtonView({
            label: 'Select File',
            icon: 'more',
            popOverView: new O.PopOverView(),
            menuView: new O.MenuView({
                showFilter: false,
                closeOnActivate: true,
                options: [
                    new O.FileButtonView({
                        label: 'Upload From Computer',
                        acceptMultiple: true,
                        target: controller,
                        method: 'uploadFiles'
                    }),
                    new O.ButtonView({
                        label: 'Select From Dropbox',
                        target: controller,
                        method: 'selectFromDropbox'
                    })
                ]
            })
        });
*/
var MenuButtonView = NS.Class({

    Extends: NS.ButtonView,

    /**
        Property: O.MenuButtonView#type
        Type: String
        Default: 'v-MenuButton'

        Overrides default in <O.ButtonView#type>.
    */
    type: 'v-MenuButton',

    /**
        Property: O.MenuButtonView#popOverView
        Type: O.PopOverView

        The <O.PopOverView> instance to use to show the menu view.
    */
    popOverView: null,

    /**
        Property: O.MenuButtonView#popOverViewOptions
        Type: Object

        Options to pass to <O.PopOverView#show>.
    */
    popOverOptions: {},

    /**
        Property: O.MenuButtonView#menuView
        Type: O.MenuView

        The <O.MenuView> instance to show when the button is pressed.
    */
    menuView: null,

    /**
        Property: O.MenuButtonView#alignMenu
        Type: String
        Default: 'left'

        Which of the menu and button edges should be aligned? Valid options are
        'left', 'right' or 'centre'.
    */
    alignMenu: 'left',

    /**
        Property: O.MenuButtonView#isInMenu
        Type: Boolean

        Is this a child view of an <O.MenuOptionView>?
    */
    isInMenu: function () {
        return this.get( 'parentView' ) instanceof NS.MenuOptionView;
    }.property( 'parentView' ),

    // --- Accessibility ---

    didCreateLayer: function ( layer ) {
        layer.setAttribute( 'aria-expanded', 'false' );
    },

    ariaNeedsRedraw: function ( self, property, oldValue ) {
       return this.propertyNeedsRedraw( self, 'aria', oldValue );
    }.observes( 'isActive' ),

    redrawAria: function ( layer ) {
        // Set ARIA attribute to link the menu DOM element to this
        // button, so screen readers know what has opened.
        layer.setAttribute( 'aria-controls',
            this.getFromPath( 'menuView.id' ) );
        // And set ARIA attribute to say that the menu is now open
        layer.setAttribute( 'aria-expanded', this.get( 'isActive' ) + '' );
    },

    // --- Activate ---

    /**
        Method: O.MenuButtonView#activate

        Overridden to show menu associated with button, if not already visible.
        Ignores target/method/action properties.
    */
    activate: function () {
        if ( !this.get( 'isActive' ) && !this.get( 'isDisabled' ) ) {
            this.set( 'isActive', true );
            var buttonView = this,
                popOverOptions = NS.extend({
                    view: this.get( 'menuView' ),
                    alignWithView: buttonView,
                    alignEdge: this.get( 'alignMenu' ),
                    onHide: function () {
                        buttonView.set( 'isActive', false );
                        if ( menuOptionView ) {
                            menuOptionView.removeObserverForKey(
                                'isFocussed', popOverView, 'hide' );
                        }
                    }
                }, this.get( 'popOverOptions' ) ),
                popOverView, menuOptionView, rootView;
            if ( this.get( 'isInMenu' ) ) {
                popOverView = this.getParent( NS.PopOverView );
                menuOptionView = this.get( 'parentView' );
                rootView = buttonView.getParent( NS.RootView );

                popOverOptions.alignWithView = popOverView;
                popOverOptions.atNode = this.get( 'layer' );
                popOverOptions.positionToThe =
                    buttonView.getPositionRelativeTo( rootView ).left +
                    buttonView.get( 'pxWidth' ) + 180 <
                        rootView.get( 'pxWidth' ) ?
                            'right' : 'left';
                popOverOptions.alignEdge = 'top';
                popOverOptions.offsetTop =
                    popOverOptions.view.get( 'showFilter' ) ? -35 : -5;
            } else {
                popOverView = this.get( 'popOverView' );
            }
            // If the isInMenu, the popOverView used will actually be a subview
            // of this popOverView, and is returned from the show method.
            popOverView = popOverView.show( popOverOptions );
            if ( menuOptionView ) {
                menuOptionView.addObserverForKey(
                    'isFocussed', popOverView, 'hide' );
            }
        }
    },

    // --- Keep state in sync with render ---

    /**
        Method (private): O.MenuButtonView#_activateOnMousedown

        Activates the button on mousedown, not just on click. This allows the
        user to press the mouse down on the button to show the menu, drag down
        to the option they want, then release the button to select it.
    */
    _activateOnMousedown: function ( event ) {
        if ( event.button || event.metaKey || event.ctrlKey ) {
            return;
        }
        this.activate();
    }.on( 'mousedown' )
});

NS.MenuButtonView = MenuButtonView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: MenuView.js                                                          \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

// A menu option must have:
// filter( pattern ): RegExp -> Boolean
// isFocussed: Boolean
// isHidden: Boolean
// isDisabled: Boolean

var MenuController = NS.Class({

    Extends: NS.Object,

    options: [],

    // --- Focus ---

    canSelect: function ( option ) {
        return !option.get( 'isHidden' ) && !option.get( 'isDisabled' );
    },

    focussedOption: null,

    getAdjacentOption: function ( step ) {
        var options = this.get( 'options' ),
            l = options.get( 'length' ),
            i = options.indexOf( this.get( 'focussedOption' ) ),
            current;

        if ( i < 0 && step < 0 ) {
            i = l;
        }
        current = i.mod( l );

        do {
            i = ( i + step ).mod( l );
        } while ( l &&
            !this.canSelect( options.getObjectAt( i ) ) && i !== current );

        return options.getObjectAt( i );
    },

    focusPrevious: function ( event ) {
        if ( event ) { event.preventDefault(); }
        return this.focusOption( this.getAdjacentOption( -1 ) );
    },

    focusNext: function ( event ) {
        if ( event ) { event.preventDefault(); }
        return this.focusOption( this.getAdjacentOption( 1 ) );
    },

    focusOption: function ( option ) {
        var current = this.get( 'focussedOption' );
        if ( current !== option ) {
            if ( current ) {
                current.set( 'isFocussed', false );
            }
            if ( option ) {
                if ( !this.canSelect( option ) ) {
                    option = null;
                } else {
                    option.set( 'isFocussed', true );
                }
            }
            this.set( 'focussedOption', option );
        }
        return this;
    },

    blurOption: function ( option ) {
        if ( this.get( 'focussedOption' ) === option ) {
            this.focusOption( null );
        }
        return this;
    },

    selectFocussed: function ( event ) {
        if ( event ) { event.preventDefault(); }
        var focussedOption = this.get( 'focussedOption' );
        if ( focussedOption && this.canSelect( focussedOption ) ) {
            focussedOption.activate( this );
        }
        return this;
    },

    // --- Filter ---

    filter: '',

    filterDidChange: function () {
        var value = this.get( 'filter' ).escapeRegExp(),
            pattern = value ? NS.i18n.makeSearchRegExp( value ) : null,
            options = this.get( 'options' ),
            l = options.get( 'length' ),
            focussedOption = this.get( 'focussedOption' );

        while ( l-- ) {
            options.getObjectAt( l ).filter( pattern );
        }
        if ( !focussedOption || !this.canSelect( focussedOption ) ) {
            this.focusOption( null ).focusNext();
        }
    }.observes( 'filter' ),

    // --- Keyboard support ---

    keyBindings: {
        esc: 'onEscape',
        enter: 'selectFocussed',
        up: 'focusPrevious',
        down: 'focusNext',
        left: 'closeIfSub',
        right: 'activateIfMenu'
    },

    triggerKeyBinding: function ( event ) {
        var key = NS.DOMEvent.lookupKey( event ),
            bindings = this.get( 'keyBindings' );
        if ( bindings[ key ] ) {
            event.stopPropagation();
            this[ bindings[ key ] ]( event, key );
        }
    }.on( 'keydown' ),

    onEscape: function ( event ) {
        event.preventDefault();
        var filter = this.get( 'filter' );
        if ( filter ) {
            this.set( 'filter', '' );
        } else {
            this.get( 'view' ).hide();
        }
    },

    closeIfSub: function () {
        var view = this.get( 'view' ),
            popOverView;
        if ( !view.get( 'showFilter' ) &&
                ( popOverView = view.getParent( NS.PopOverView ) ) &&
                  popOverView.get( 'parentPopOverView' ) ) {
            view.hide();
        }
    },

    activateIfMenu: function () {
        var focussedOption = this.get( 'focussedOption' );
        if ( focussedOption &&
                focussedOption.get( 'button' ) instanceof NS.MenuButtonView ) {
            this.selectFocussed();
        }
    }
});

var MenuOptionView = NS.Class({

    Extends: NS.View,

    isHidden: false,
    isDisabled: function () {
        return this.getFromPath( 'button.isDisabled' );
    }.property( 'button.isDisabled' ),
    isFocussed: false,
    isFocussable: function () {
        return !this.get( 'isHidden' ) && !this.get( 'isDisabled' );
    }.property( 'isHidden', 'isDisabled' ),

    layerTag: 'li',

    className: function () {
        return 'v-MenuOption' +
            ( this.get( 'isFocussed' ) ? ' is-focussed' : '' ) +
            ( this.get( 'isHidden' ) ? ' u-hidden' : '' );
    }.property( 'isFocussed', 'isHidden' ),

    init: function ( view, controller ) {
        this.childViews = [ view ];
        this.button = view;
        this.controller = controller;
        MenuOptionView.parent.init.call( this );
    },

    scrollIntoView: function () {
        if ( this.get( 'isFocussed' ) ) {
            var scrollView = this.getParent( NS.ScrollView );
            if ( scrollView ) {
                var scrollHeight = scrollView.get( 'pxHeight' ),
                    scrollTop = scrollView.get( 'scrollTop' ),
                    top = this.getPositionRelativeTo( scrollView ).top,
                    height = this.get( 'pxHeight' );

                if ( top < scrollTop ) {
                    scrollView.scrollTo( 0, top - ( height >> 1 ), true );
                } else if ( top + height > scrollTop + scrollHeight ) {
                    scrollView.scrollTo( 0,
                        top + height - scrollHeight + ( height >> 1 ), true );
                }
            }
            if ( !this.getParent( MenuView ).get( 'showFilter' ) ) {
                this.button.focus();
            }
        }
    }.observes( 'isFocussed' ),

    _focusTimeout: null,

    takeFocus: function () {
        if ( this.get( 'isInDocument' ) ) {
            this.get( 'controller' ).focusOption( this )
                .activateIfMenu();
        }
    },

    mouseMove: function () {
        if ( !this.get( 'isFocussed' ) && !this._focusTimeout ) {
            var popOverView = this.getParent( NS.PopOverView );
            if ( popOverView && popOverView.hasSubView() ) {
                this._focusTimeout = NS.RunLoop.invokeAfterDelay(
                    this.takeFocus, 75, this );
            } else {
                this.takeFocus();
            }
        }
    }.on( 'mousemove' ),

    mouseOut: function () {
        if ( this._focusTimeout ) {
            NS.RunLoop.cancel( this._focusTimeout );
            this._focusTimeout = null;
        }
        if ( !this.get( 'button' ).get( 'isActive' ) ) {
            this.get( 'controller' ).blurOption( this );
        }
    }.on( 'mouseout' ),

    filter: function ( pattern ) {
        var label = this.get( 'button' ).get( 'label' );
        this.set( 'isHidden', !!pattern && !pattern.test( label ) );
    },

    activate: function () {
        var button = this.get( 'button' );
        if ( button.activate ) { button.activate(); }
    }
});

var MenuView = NS.Class({

    Extends: NS.View,

    className: 'v-Menu',

    showFilter: false,
    closeOnActivate: true,

    didCreateLayer: function ( layer ) {
        MenuView.parent.didCreateLayer.call( this, layer );
        layer.addEventListener( 'mousemove', this, false );
        layer.addEventListener( 'mouseout', this, false );
    },

    willDestroyLayer: function ( layer ) {
        layer.removeEventListener( 'mouseout', this, false );
        layer.removeEventListener( 'mousemove', this, false );
        MenuView.parent.willDestroyLayer.call( this, layer );
    },

    didEnterDocument: function () {
        MenuView.parent.didEnterDocument.call( this );
        var scrollView = this._scrollView,
            windowHeight, delta, controller, input;
        if ( scrollView ) {
            windowHeight = ( this.getParent( NS.ScrollView ) ||
                this.getParent( NS.RootView ) ).get( 'pxHeight' );
            delta = this.get( 'layer' ).getBoundingClientRect().bottom -
                windowHeight;
            // Must redraw immediately so size is correct when PopOverView
            // checks if it is positioned off screen.
            scrollView.set( 'layout', {
                maxHeight: Math.max(
                    scrollView.get( 'pxHeight' ) - delta - 10,
                    windowHeight / 2
                )
            }).redraw();
        }

        if ( this.get( 'showFilter' ) ) {
            controller = this.get( 'controller' );
            input = this._input;
            if ( !controller.get( 'focussedOption' ) ) {
                controller.focusNext();
            }
            NS.RunLoop.invokeInNextFrame( function () {
                input.focus().set( 'selection', {
                    start: 0,
                    end: input.get( 'value' ).length
                });
            });
        }
        return this;
    },

    didLeaveDocument: function () {
        var controller = this.get( 'controller' );
        if ( this.get( 'showFilter' ) ) {
            controller.set( 'filter', '' );
        } else {
            controller.focusOption( null );
        }
        return MenuView.parent.didLeaveDocument.call( this );
    },

    mayHaveResized: function () {
        this.parentViewDidResize();
    }.queue( 'after' ).observes( 'controller.filter' ),

    nextEventTarget: function () {
        return this.get( 'controller' );
    }.property( 'controller' ),

    controller: function () {
        return new MenuController({
            view: this
        });
    }.property(),

    ItemView: MenuOptionView,

    draw: function ( layer, Element, el ) {
        var controller = this.get( 'controller' ),
            MenuOptionView = this.get( 'ItemView' ),
            optionViews = this.get( 'options' ).map( function ( view ) {
                return new MenuOptionView( view, controller );
            });
        controller.set( 'options', optionViews );
        return [
            this.get( 'showFilter' ) ? el( 'div.v-Menu-filter', [
                this._input = new NS.SearchTextView({
                    blurOnEscape: false,
                    value: NS.bindTwoWay( 'filter', this.get( 'controller' ) )
                })
            ]) : null,
            this._scrollView = new NS.ScrollView({
                positioning: 'relative',
                layout: {},
                layerTag: 'ul',
                childViews: optionViews
            })
        ];
    },

    hide: function () {
        var parent = this.get( 'parentView' );
        if ( parent ) {
            NS.RunLoop.invokeInNextFrame( parent.hide, parent );
        }
    },

    hideAll: function () {
        if ( this.get( 'closeOnActivate' ) ) {
            var popOverView = this.getParent( NS.PopOverView ) ||
                    this.get( 'parentView' ),
                parent;
            if ( popOverView ) {
                while ( parent = popOverView.get( 'parentPopOverView' ) ) {
                    popOverView = parent;
                }
                NS.RunLoop.invokeInNextFrame( popOverView.hide, popOverView );
            }
        }
    }.on( 'button:activate' ),

    fireShortcut: function ( event ) {
        if ( !this.get( 'showFilter' ) ) {
            var key = NS.DOMEvent.lookupKey( event ),
                handler = NS.ViewEventsController
                            .kbShortcuts.getHandlerForKey( key ),
                parent, object, method;
            if ( handler ) {
                parent = object = handler[0];
                method = handler[1];
                // Check object is child view of the menu; we want to ignore any
                // other keyboard shortcuts.
                if ( object instanceof NS.View ) {
                    while ( parent && parent !== this ) {
                        parent = parent.get( 'parentView' );
                    }
                    if ( parent ) {
                        object[ method ]( event );
                        event.preventDefault();
                    }
                }
            }
        }
    }.on( 'keypress' )
});

NS.MenuController = MenuController;
NS.MenuOptionView = MenuOptionView;
NS.MenuView = MenuView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RadioView.js                                                         \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, CheckboxView.js                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.RadioView

    Extends: O.AbstractControlView

    A radio-button control view. The `value` property is two-way bindable,
    representing the state of the button (`true` => selected).
*/
var RadioView = NS.Class({

    Extends: NS.AbstractControlView,

    // --- Render ---

    type: '',

    /**
        Property: O.RadioView#className
        Type: String
        Default: 'v-Radio'

        Overrides default in <O.View#className>.
    */
    className: function () {
        var type = this.get( 'type' );
        return 'v-Radio ' +
            ( this.get( 'value' ) ? 'is-checked' : 'is-unchecked' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' ) +
            ( type ? ' ' + type : '' );
    }.property( 'type', 'value', 'isDisabled' ),

    /**
        Method: O.RadioView#draw

        Overridden to draw radio button in layer. See <O.View#draw>.
    */
    draw: function ( layer, Element, el ) {
        return [
            this._domControl = el( 'input', {
                className: 'v-Radio-input',
                type: 'radio',
                checked: this.get( 'value' )
            }),
            RadioView.parent.draw.call( this, layer, Element, el )
        ];
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.RadioView#radioNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    radioNeedsRedraw: NS.CheckboxView.prototype.checkboxNeedsRedraw,

    /**
        Method: O.RadioView#redrawValue

        Updates the checked status of the DOM `<input type="radio">` to match
        the value property of the view.
    */
    redrawValue: NS.CheckboxView.prototype.redrawValue,

    // --- Keep state in sync with render ---

    /**
        Method: O.RadioView#activate

        Overridden to set the view as selected. See
        <O.AbstractControlView#activate>.
    */
    activate: function () {
        if ( !this.get( 'isDisabled' ) ) {
            this.set( 'value', true );
        }
    }.on( 'click' )
});

NS.RadioView = RadioView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: RichTextView.js                                                      \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, PanelViews, DragDrop                \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document, window, FileReader, Squire */

( function ( NS, undefined ) {

var execCommand = function ( command ) {
    return function ( arg ) {
        var editor = this.get( 'editor' );
        if ( editor ) {
            editor[ command ]( arg );
        }
        return this;
    };
};

var queryCommandState = function ( tag, regexp ) {
    return function () {
        var path = this.get( 'path' );
        return path === '(selection)' ?
            this.get( 'editor' )
                .hasFormat( tag ) : ( regexp ).test( path );
    }.property( 'path' );
};

var emailRegExp = RegExp.email,
    // Use a more relaxed definition of a URL than normal; anything URL-like we
    // want to accept so we can prefill the link destination box.
    urlRegExp =
        /^(?:https?:\/\/)?[\w.]+[.][a-z]{2,4}(?:\/[^\s()<>]+|\([^\s()<>]+\))*/i;

var popOver = new NS.PopOverView();

var ButtonView = NS.ButtonView;
var equalTo = NS.Transform.isEqualToValue;

var RichTextView = NS.Class({

    Extends: NS.View,

    Mixin: NS.DropTarget,

    isFocussed: false,
    isExpanding: false,

    showToolbar: !NS.UA.isIOS,

    editor: null,

    styles: null,

    _value: '',
    value: function ( html ) {
        var editor = this.get( 'editor' );
        if ( editor ) {
            if ( html !== undefined ) {
                editor.setHTML( html );
            } else {
                html = editor.getHTML();
            }
        } else {
            if ( html !== undefined ) {
                this._value = html;
            } else {
                html = this._value;
            }
        }
        return html;
    }.property().nocache(),

    // --- Render ---

    willEnterDocument: function () {
        this.set( 'path', '' );
        return RichTextView.parent.willEnterDocument.call( this );
    },

    didEnterDocument: function () {
        if ( this.get( 'showToolbar' ) && this.get( 'isExpanding' ) ) {
            var scrollView = this.getParent( NS.ScrollView );
            if ( scrollView ) {
                scrollView.addObserverForKey(
                    'scrollTop', this, '_calcToolbarPosition' );
            }
        }
        return RichTextView.parent.didEnterDocument.call( this );
    },

    willLeaveDocument: function () {
        if ( this.get( 'showToolbar' ) && this.get( 'isExpanding' ) ) {
            var scrollView = this.getParent( NS.ScrollView );
            if ( scrollView ) {
                scrollView.removeObserverForKey(
                    'scrollTop', this, '_calcToolbarPosition' );
            }
            this._setToolbarPosition(
                scrollView, this.get( 'toolbarView' ), false );
        }
        // As soon as the view is removed from the document, any editor
        // reference is no longer valid, as the iframe will have been unloaded.
        // The reference will be recreated when the iframe is appended
        // again. Must cache the value before it is removed though.
        var editor = this.get( 'editor' );
        if ( editor ) {
            this._value = editor.getHTML( this.get( 'isFocussed' ) );
            editor.destroy();
            this.set( 'editor', null );
        }
        return RichTextView.parent.willLeaveDocument.call( this );
    },

    className: function () {
        return 'v-RichText' +
            ( NS.UA.isIOS ? ' v-RichText--iOS' : '' ) +
            ( this.get( 'showToolbar' ) ? '' : ' v-RichText--noToolbar' );
    }.property(),

    draw: function ( layer, Element, el ) {
        var richTextView = this;
        var iframe = el( 'iframe.v-RichText-input' );
        var onload = function () {
            // Make sure we're in standards mode.
            var doc = iframe.contentDocument;
            if ( doc.compatMode !== 'CSS1Compat' ) {
                doc.open();
                doc.write( '<!DOCTYPE html><title></title>' );
                doc.close();
            }
            // doc.close() can cause a re-entrant load event in some browsers,
            // such as IE9.
            if ( richTextView.get( 'editor' ) ) {
                return;
            }
            // Create Squire instance
            var editor = new Squire( doc );
            editor.didError = NS.RunLoop.didError;
            richTextView.set( 'editor', editor
                .addStyles( richTextView.get( 'styles' ) )
                .setHTML( richTextView._value )
                .addEventListener( 'load', richTextView )
                .addEventListener( 'keydown', richTextView )
                .addEventListener( 'keypress', richTextView )
                .addEventListener( 'keyup', richTextView )
                .addEventListener( 'mousedown', richTextView )
                .addEventListener( 'click', richTextView )
                .addEventListener( 'focus', richTextView )
                .addEventListener( 'blur', richTextView )
                .addEventListener( 'input', richTextView )
                .addEventListener( 'dragenter', richTextView )
                .addEventListener( 'dragleave', richTextView )
                .addEventListener( 'dragover', richTextView )
                .addEventListener( 'drop', richTextView )
                .addEventListener( 'select', richTextView )
                .addEventListener( 'pathChange', richTextView )
                .addEventListener( 'undoStateChange', richTextView )
            ).set( 'path', editor.getPath() )
             .expand();
            if ( richTextView.get( 'isFocussed' ) ) {
                editor.focus();
            }
        }.invokeInRunLoop();

        iframe.addEventListener( 'load', onload, false );

        return [
            this.get( 'showToolbar' ) ? this.get( 'toolbarView' ) : null,
            el( 'div.v-RichText-content', [ iframe ] )
        ];
    },

    expand: function () {
        if ( !NS.UA.isIOS && this.get( 'isExpanding' ) ) {
            var editor = this.get( 'editor' ),
                doc = editor && editor.getDocument(),
                body = doc && doc.body,
                lastChild = body && body.lastChild;

            if ( !lastChild ) {
                return;
            }

            var chromeHeight = this._chromeHeight || ( this._chromeHeight =
                    this.get( 'pxHeight' ) - body.offsetHeight ),
                height = lastChild.offsetTop + lastChild.offsetHeight +
                    chromeHeight + 30,
                layout = this.get( 'layout' );

            if ( layout.height !== height ) {
                layout = NS.clone( layout );
                layout.height = height;
                this.set( 'layout', layout );
            }
        }
    }.queue( 'after' ).on( 'input', 'load' ),

    _calcToolbarPosition: function ( scrollView, _, __, scrollTop ) {
        var toolbarView = this.get( 'toolbarView' ),
            offsetHeight = this._offsetHeight,
            offsetTop = this._offsetTop,
            now = Date.now(),
            wasSticky = toolbarView.get( 'parentView' ) !== this,
            isSticky;

        // For performance, cache the size and position for 1/2 second from last
        // use.
        if ( !offsetTop || this._offsetExpiry < now ) {
            this._offsetHeight = offsetHeight =
                this.get( 'layer' ).offsetHeight;
            this._offsetTop = offsetTop =
                Math.floor( this.getPositionRelativeTo( scrollView ).top );
        }
        this._offsetExpiry = now + 500;

        isSticky =
            scrollTop > offsetTop &&
            scrollTop < offsetTop + offsetHeight -
                ( scrollView.get( 'pxHeight' ) >> 2 );

        if ( isSticky !== wasSticky ) {
            this._setToolbarPosition( scrollView, toolbarView, isSticky );
        }
    },
    _setToolbarPosition: function ( scrollView, toolbarView, isSticky ) {
        if ( isSticky ) {
            var newParent = scrollView.get( 'parentView' ),
                position = toolbarView.getPositionRelativeTo( newParent ),
                // Need to account separately for any border in the new parent.
                borders = scrollView.getPositionRelativeTo( newParent );
            toolbarView
                .set( 'className', 'v-Toolbar v-RichText-toolbar is-sticky' )
                .set( 'layout', {
                    top: scrollView.get( 'pxTop' ),
                    left: position.left - borders.left,
                    width: toolbarView.get( 'pxWidth' )
                });
            newParent.insertView( toolbarView );
        } else {
            toolbarView
                .set( 'className', 'v-Toolbar v-RichText-toolbar' )
                .set( 'layout', {
                    top: 0,
                    left: 0,
                    right: 0
                });
            this.insertView( toolbarView, null, 'top' );
        }
    },

    toolbarConfig: {
        left: [
            'bold', 'italic', 'underline', 'strikethrough', '-',
            'font', 'size', '-',
            'colour', 'bgcolour', '-',
            'image', '-',
            'link', '-',
            'ul', 'ol', '-',
            'quote', 'unquote', '-',
            'left', 'centre', 'right', 'justify', '-',
            'ltr', 'rtl', '-',
            'unformat'
        ],
        right: []
    },

    toolbarView: function () {
        var bind = NS.bind,
            richTextView = this;

        return new NS.ToolbarView({
            className: 'v-Toolbar v-RichText-toolbar',
            positioning: 'absolute',
            layout: {
                overflow: 'hidden',
                zIndex: 1,
                top: 0,
                left: 0,
                right: 0
            },
            preventOverlap: true
        }).registerViews({
            bold: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-bold',
                isActive: bind( 'isBold', this ),
                label: NS.loc( 'Bold' ),
                tooltip: NS.loc( 'Bold' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-b' ),
                activate: function () {
                    if ( richTextView.get( 'isBold' ) ) {
                        richTextView.removeBold();
                    } else {
                        richTextView.bold();
                    }
                    this.fire( 'button:activate' );
                }
            }),
            italic: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-italic',
                isActive: bind( 'isItalic', this ),
                label: NS.loc( 'Italic' ),
                tooltip: NS.loc( 'Italic' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-i' ),
                activate: function () {
                    if ( richTextView.get( 'isItalic' ) ) {
                        richTextView.removeItalic();
                    } else {
                        richTextView.italic();
                    }
                    this.fire( 'button:activate' );
                }
            }),
            underline: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-underline',
                isActive: bind( 'isUnderlined', this ),
                label: NS.loc( 'Underline' ),
                tooltip: NS.loc( 'Underline' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-u' ),
                activate: function () {
                    if ( richTextView.get( 'isUnderlined' ) ) {
                        richTextView.removeUnderline();
                    } else {
                        richTextView.underline();
                    }
                    this.fire( 'button:activate' );
                }
            }),
            strikethrough: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-strikethrough',
                isActive: bind( 'isStriked', this ),
                label: NS.loc( 'Strikethrough' ),
                tooltip: NS.loc( 'Strikethrough' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-shift-7' ),
                activate: function () {
                    if ( richTextView.get( 'isStriked' ) ) {
                        richTextView.removeStrikethrough();
                    } else {
                        richTextView.strikethrough();
                    }
                    this.fire( 'button:activate' );
                }
            }),
            size: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-font-size',
                label: NS.loc( 'Font Size' ),
                tooltip: NS.loc( 'Font Size' ),
                target: this,
                method: 'showFontSizeMenu'
            }),
            font: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-font',
                label: NS.loc( 'Font Face' ),
                tooltip: NS.loc( 'Font Face' ),
                target: this,
                method: 'showFontFaceMenu'
            }),
            colour: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-palette',
                label: NS.loc( 'Text Color' ),
                tooltip: NS.loc( 'Text Color' ),
                target: this,
                method: 'showTextColourMenu'
            }),
            bgcolour: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-highlight',
                label: NS.loc( 'Text Highlight' ),
                tooltip: NS.loc( 'Text Highlight' ),
                target: this,
                method: 'showTextHighlightColourMenu'
            }),
            link: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-link',
                isActive: bind( 'isLink', this ),
                label: NS.loc( 'Link' ),
                tooltip: NS.loc( 'Link' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-k' ),
                activate: function () {
                    if ( richTextView.get( 'isLink' ) ) {
                        richTextView.removeLink();
                    } else {
                        richTextView.showLinkOverlay( this );
                    }
                    this.fire( 'button:activate' );
                }
            }),
            image: new NS.FileButtonView({
                type: 'v-FileButton v-Button--iconOnly',
                icon: 'icon-image',
                label: NS.loc( 'Insert Image' ),
                tooltip: NS.loc( 'Insert Image' ),
                acceptMultiple: true,
                acceptOnlyTypes: 'image/jpeg, image/png, image/gif',
                target: this,
                method: 'insertImagesFromFiles'
            }),
            left: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-left',
                isActive: bind( 'alignment', this, equalTo( 'left' ) ),
                label: NS.loc( 'Left' ),
                tooltip: NS.loc( 'Left' ),
                activate: function () {
                    richTextView.setTextAlignment( 'left' );
                    this.fire( 'button:activate' );
                }
            }),
            centre: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-centre',
                isActive: bind( 'alignment', this, equalTo( 'center' ) ),
                label: NS.loc( 'Center' ),
                tooltip: NS.loc( 'Center' ),
                activate: function () {
                    richTextView.setTextAlignment( 'center' );
                    this.fire( 'button:activate' );
                }
            }),
            right: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-right',
                isActive: bind( 'alignment', this, equalTo( 'right' ) ),
                label: NS.loc( 'Right' ),
                tooltip: NS.loc( 'Right' ),
                activate: function () {
                    richTextView.setTextAlignment( 'right' );
                    this.fire( 'button:activate' );
                }
            }),
            justify: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-justify',
                isActive: bind( 'alignment', this, equalTo( 'justify' ) ),
                label: NS.loc( 'Justify' ),
                tooltip: NS.loc( 'Justify' ),
                activate: function () {
                    richTextView.setTextAlignment( 'justify' );
                    this.fire( 'button:activate' );
                }
            }),
            ltr: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-lefttoright',
                isActive: bind( 'direction', this, equalTo( 'ltr' ) ),
                label: NS.loc( 'Text Direction: Left to Right' ),
                tooltip: NS.loc( 'Text Direction: Left to Right' ),
                activate: function () {
                    richTextView.setTextDirection( 'ltr' );
                    this.fire( 'button:activate' );
                }
            }),
            rtl: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-righttoleft',
                isActive: bind( 'direction', this, equalTo( 'rtl' ) ),
                label: NS.loc( 'Text Direction: Right to Left' ),
                tooltip: NS.loc( 'Text Direction: Right to Left' ),
                activate: function () {
                    richTextView.setTextDirection( 'rtl' );
                    this.fire( 'button:activate' );
                }
            }),
            quote: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-quotes-left',
                label: NS.loc( 'Quote' ),
                tooltip: NS.loc( 'Quote' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-]' ),
                target: richTextView,
                method: 'increaseQuoteLevel'
            }),
            unquote: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-quotes-right',
                label: NS.loc( 'Unquote' ),
                tooltip: NS.loc( 'Unquote' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-[' ),
                target: richTextView,
                method: 'decreaseQuoteLevel'
            }),
            ul: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-list',
                isActive: bind( 'isUnorderedList', this ),
                label: NS.loc( 'Unordered List' ),
                tooltip: NS.loc( 'Unordered List' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-shift-8' ),
                activate: function () {
                    if ( richTextView.get( 'isUnorderedList' ) ) {
                        richTextView.removeList();
                    } else {
                        richTextView.makeUnorderedList();
                    }
                    this.fire( 'button:activate' );
                }
            }),
            ol: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-numbered-list',
                isActive: bind( 'isOrderedList', this ),
                label: NS.loc( 'Ordered List' ),
                tooltip: NS.loc( 'Ordered List' ) + '\n' +
                    NS.formatKeyForPlatform( 'cmd-shift-9' ),
                activate: function () {
                    if ( richTextView.get( 'isOrderedList' ) ) {
                        richTextView.removeList();
                    } else {
                        richTextView.makeOrderedList();
                    }
                    this.fire( 'button:activate' );
                }
            }),
            unformat: new ButtonView({
                type: 'v-Button--iconOnly',
                icon: 'icon-clear-formatting',
                label: NS.loc( 'Clear Formatting' ),
                tooltip: NS.loc( 'Clear Formatting' ),
                activate: function () {
                    richTextView.removeAllFormatting();
                    this.fire( 'button:activate' );
                }
            })
        }).registerConfig( 'standard', this.get( 'toolbarConfig' ) );
    }.property(),

    fontSizeMenuView: function () {
        var richTextView = this;
        return new NS.MenuView({
            showFilter: false,
            options: [
                [ NS.loc( 'Small' ), '10px'  ],
                [ NS.loc( 'Medium' ), '13px' ],
                [ NS.loc( 'Large' ), '16px'  ],
                [ NS.loc( 'Huge' ), '22px'   ]
            ].map( function ( item ) {
                return new ButtonView({
                    layout: {
                        fontSize: item[1]
                    },
                    label: item[0],
                    method: 'setFontSize',
                    setFontSize: function () {
                        richTextView.setFontSize( item[1] );
                    }
                });
            })
        });
    }.property(),

    showFontSizeMenu: function ( buttonView ) {
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( NS.MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'fontSizeMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2
        });
    },

    fontFaceMenuView: function () {
        var richTextView = this;
        return new NS.MenuView({
            showFilter: false,
            options: [
                [ 'Arial', 'arial, sans-serif' ],
                [ 'Georgia', 'georgia, serif' ],
                [ 'Helvetica', 'helvetica, arial, sans-serif' ],
                [ 'Monospace', 'menlo, consolas, "courier new", monospace' ],
                [ 'Tahoma', 'tahoma, sans-serif' ],
                [ 'Times New Roman', '"Times New Roman", times, serif' ],
                [ 'Trebuchet MS', '"Trebuchet MS", sans-serif' ],
                [ 'Verdana', 'verdana, sans-serif' ]
            ].map( function ( item ) {
                return new ButtonView({
                    layout: {
                        fontFamily: item[1]
                    },
                    label: item[0],
                    method: 'setFontFace',
                    setFontFace: function () {
                        richTextView.setFontFace( item[1] );
                    }
                });
            })
        });
    }.property(),

    showFontFaceMenu: function ( buttonView ) {
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( NS.MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'fontFaceMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2
        });
    },

    _colourText: true,

    textColourMenuView: function () {
        var richTextView = this;
        return new NS.MenuView({
            className: 'v-ColourMenu',
            showFilter: false,
            options: (
                '000000 b22222 ff0000 ffa07a fff0f5 ' +
                '800000 a52a2a ff8c00 ffa500 faebd7 ' +
                '8b4513 daa520 ffd700 ffff00 ffffe0 ' +
                '2f4f4f 006400 008000 00ff00 f0fff0 ' +
                '008080 40e0d0 00ffff afeeee f0ffff ' +
                '000080 0000cd 0000ff add8e6 f0f8ff ' +
                '4b0082 800080 ee82ee dda0dd e6e6fa ' +
                '696969 808080 a9a9a9 d3d3d3 ffffff' )
                .split( ' ' )
                .map( function ( colour ) {
                    colour = '#' + colour;
                    return new ButtonView({
                        layout: {
                            backgroundColor: colour
                        },
                        label: colour,
                        method: 'setColour',
                        setColour: function () {
                            if ( richTextView._colourText ) {
                                richTextView.setTextColour( colour );
                            } else {
                                richTextView.setHighlightColour( colour );
                            }
                        }
                    });
                })
        });
    }.property(),

    showTextColourMenu: function ( buttonView ) {
        this._colourText = true;
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( NS.MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'textColourMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2
        });
    },

    showTextHighlightColourMenu: function ( buttonView ) {
        this._colourText = false;
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( NS.MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'textColourMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2
        });
    },

    linkOverlayView: function () {
        var richTextView = this;
        return new NS.View({
            className: 'v-UrlPicker',
            value: '',
            draw: function ( layer, Element, el ) {
                return [
                    el( 'h3.u-bold', [
                        NS.loc( 'Add a link to the following URL or email:' )
                    ]),
                    this._input = new NS.TextView({
                        value: NS.bindTwoWay( 'value', this ),
                        placeholder: 'e.g. www.example.com'
                    }),
                    el( 'p.u-alignRight', [
                        new ButtonView({
                            type: 'v-Button--destructive v-Button--size13',
                            label: NS.loc( 'Cancel' ),
                            target: popOver,
                            method: 'hide'
                        }),
                        new ButtonView({
                            type: 'v-Button--constructive v-Button--size13',
                            label: NS.loc( 'Add Link' ),
                            target: this,
                            method: 'addLink'
                        })
                    ])
                ];
            },
            focus: function () {
                if ( this.get( 'isInDocument' ) ) {
                    this._input.set( 'selection', this.get( 'value' ).length )
                               .focus();
                    // IE8 and Safari 6 don't fire this event for some reason.
                    this._input.fire( 'focus' );
                }
            }.nextFrame().observes( 'isInDocument' ),
            addLinkOnEnter: function ( event ) {
                event.stopPropagation();
                if ( NS.DOMEvent.lookupKey( event ) === 'enter' ) {
                    this.addLink();
                }
            }.on( 'keyup' ),
            addLink: function () {
                var url = this.get( 'value' ).trim(),
                    email;
                // Don't allow malicious links
                if ( /^(?:javascript|data):/i.test( url ) ) {
                    return;
                }
                // If it appears to start with a url protocol,
                // pass it through verbatim.
                if ( !( /[a-z][\w\-]+:/i.test( url ) ) ) {
                    // Otherwise, look for an email address,
                    // and add a mailto: handler, if found.
                    email = emailRegExp.exec( url );
                    if ( email ) {
                        url = 'mailto:' + email[0];
                    }
                    // Or an http:// prefix if not.
                    else {
                        url = 'http://' + url;
                    }
                }
                richTextView.makeLink( url );
                popOver.hide();
                richTextView.focus();
            }
        });
    }.property(),

    showLinkOverlay: function ( buttonView ) {
        var view = this.get( 'linkOverlayView' ),
            value = this.getSelectedText().trim();
        if ( !urlRegExp.test( value ) && !emailRegExp.test( value ) ) {
            value = '';
        }
        view.set( 'value', value );
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( NS.MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: view,
            alignWithView: buttonView,
            showCallout: true,
            offsetTop: 2,
            offsetLeft: -4
        });
    },

    // --- Commands ---

    focus: function () {
        var editor = this.get( 'editor' );
        if ( editor ) {
            editor.focus();
        } else {
            this.set( 'isFocussed', true );
        }
        return this;
    },

    blur: function () {
        var editor = this.get( 'editor' );
        if ( editor ) {
            editor.blur();
        } else {
            this.set( 'isFocussed', false );
        }
        return this;
    },

    undo: execCommand( 'undo' ),
    redo: execCommand( 'redo' ),

    bold: execCommand( 'bold' ),
    italic: execCommand( 'italic' ),
    underline: execCommand( 'underline' ),
    strikethrough: execCommand( 'strikethrough' ),

    removeBold: execCommand( 'removeBold' ),
    removeItalic: execCommand( 'removeItalic' ),
    removeUnderline: execCommand( 'removeUnderline' ),
    removeStrikethrough: execCommand( 'removeStrikethrough' ),

    makeLink: execCommand( 'makeLink' ),
    removeLink: execCommand( 'removeLink' ),

    setFontFace: execCommand( 'setFontFace' ),
    setFontSize: execCommand( 'setFontSize' ),

    setTextColour: execCommand( 'setTextColour' ),
    setHighlightColour: execCommand( 'setHighlightColour' ),

    setTextAlignment: execCommand( 'setTextAlignment' ),
    setTextDirection: execCommand( 'setTextDirection' ),

    increaseQuoteLevel: execCommand( 'increaseQuoteLevel' ),
    decreaseQuoteLevel: execCommand( 'decreaseQuoteLevel' ),

    makeUnorderedList: execCommand( 'makeUnorderedList' ),
    makeOrderedList: execCommand( 'makeOrderedList' ),
    removeList: execCommand( 'removeList' ),

    increaseListLevel: execCommand( 'increaseListLevel' ),
    decreaseListLevel: execCommand( 'decreaseListLevel' ),

    removeAllFormatting: execCommand( 'removeAllFormatting' ),

    insertImage: execCommand( 'insertImage' ),
    insertImagesFromFiles: function ( files ) {
        if ( window.FileReader ) {
            files.forEach( function ( file ) {
                var img = this.get( 'editor' ).insertImage(),
                    reader = new FileReader();
                reader.onload = function () {
                    img.src = reader.result;
                    reader.onload = null;
                };
                reader.readAsDataURL( file );
            }, this );
        }
    },

    getSelectedText: function () {
        var editor = this.get( 'editor' );
        return editor ? editor.getSelectedText() : '';
    },

    kbShortcuts: function ( event ) {
        var isMac = NS.UA.isMac;
        switch ( NS.DOMEvent.lookupKey( event ) ) {
        case isMac ? 'meta-k' : 'ctrl-k':
            event.preventDefault();
            this.showLinkOverlay(
                this.get( 'toolbarView' ).getView( 'link' )
            );
            break;
        case 'pagedown':
            if ( !isMac && this.get( 'isExpanding' ) ) {
                var scrollView = this.getParent( NS.ScrollView );
                if ( scrollView ) {
                    scrollView.scrollToView( this, {
                        y: 32 +
                            this.get( 'pxHeight' ) -
                            scrollView.get( 'pxHeight' )
                    }, true );
                }
            }
            break;
        }
    }.on( 'keydown' ),

    // Low level commands

    _forEachBlock: execCommand( 'forEachBlock' ),

    // --- Command state ---

    canUndo: false,
    canRedo: false,

    setUndoState: function ( event ) {
        this.set( 'canUndo', event.canUndo )
            .set( 'canRedo', event.canRedo );
        event.stopPropagation();
    }.on( 'undoStateChange' ),

    path: '',

    setPath: function ( event ) {
        this.set( 'path', event.path );
        event.stopPropagation();
    }.on( 'pathChange' ),

    onSelect: function () {
        this.propertyDidChange( 'path' );
    }.on( 'select' ),

    isBold: queryCommandState( 'B', ( />B\b/ ) ),
    isItalic: queryCommandState( 'I', ( />I\b/ ) ),
    isUnderlined: queryCommandState( 'U', ( />U\b/ ) ),
    isStriked: queryCommandState( 'S', ( />S\b/ ) ),
    isLink: queryCommandState( 'A', ( />A\b/ ) ),

    alignment: function () {
        var path = this.get( 'path' ),
            results = /\.align\-(\w+)/.exec( path ),
            alignment;
        if ( path === '(selection)' ) {
            alignment = '';
            this._forEachBlock( function ( block ) {
                var align = block.style.textAlign || 'left';
                if ( alignment && align !== alignment ) {
                    alignment = '';
                    return true;
                }
                alignment = align;
                return false;
            });
        } else {
            alignment = results ? results[1] : 'left';
        }
        return alignment;
    }.property( 'path' ),

    direction: function () {
        var path = this.get( 'path' ),
            results = /\[dir=(\w+)\]/.exec( path ),
            dir;
        if ( path === '(selection)' ) {
            dir = '';
            this._forEachBlock( function ( block ) {
                var blockDir = block.dir || 'ltr';
                if ( dir && blockDir !== dir ) {
                    dir = '';
                    return true;
                }
                dir = blockDir;
                return false;
            });
        } else {
            dir = results ? results[1] : 'ltr';
        }
        return dir;
    }.property( 'path' ),

    isUnorderedList: queryCommandState( 'UL', ( />UL\b/ ) ),
    isOrderedList: queryCommandState( 'OL', ( />OL\b/ ) ),

    // --- Keep state in sync with render ---

    handleEvent: function ( event ) {
        NS.ViewEventsController.handleEvent( event, this );
    },

    _onFocus: function () {
        this.set( 'isFocussed', true );
    }.on( 'focus' ),

    _onBlur: function () {
        this.set( 'isFocussed', false );
    }.on( 'blur' ),

    blurOnEsc: function ( event ) {
        // If key == esc, we want to blur. Not all browsers do this
        // automatically.
        if ( ( event.keyCode || event.which ) === 27 ) {
            this.blur();
        }
    }.on( 'keydown' ),

    // -- Drag and drop ---

    dropAcceptedDataTypes: {
        'image/gif': true,
        'image/jpeg': true,
        'image/png': true,
        'image/tiff': true
    },

    dropEffect: NS.DragEffect.COPY,

    drop: function ( drag ) {
        var types = this.get( 'dropAcceptedDataTypes' ),
            type;
        for ( type in types ) {
            if ( drag.hasDataType( type ) ) {
                this.insertImagesFromFiles( drag.getFiles( /^image\/.*/ ) );
                break;
            }
        }
    }
});

RichTextView.isSupported = (
    ( 'contentEditable' in document.body ) &&
    ( !NS.UA.operaMobile ) &&
    ( !NS.UA.msie || NS.UA.msie > 8 ) &&
    // WKWebView (introduced in iOS8) finally supports RTV without horrendous
    // bugs. Can detect it from UIWebView by looking for indexedDB support.
    ( !NS.UA.isIOS || !!window.indexedDB )
);

NS.RichTextView = RichTextView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: TextView.js                                                          \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, AbstractControlView.js              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS, undefined ) {

var nativePlaceholder = 'placeholder' in document.createElement( 'input' );

/**
    Class: O.TextView

    Extends: O.AbstractControlView

    A text input control. The `value` property is two-way bindable, representing
    the input text.
*/
var TextView = NS.Class({

    Extends: NS.AbstractControlView,

    init: function ( mixin ) {
        TextView.parent.init.call( this, mixin );
        this._settingFromInput = false;
    },

    /**
        Property: O.TextView#isMultiline
        Type: Boolean
        Default: false

        If set to true, the text field will accept line breaks.

        This property *must not* be changed after the view has been rendered.
    */
    isMultiline: false,

    /**
        Property: O.TextView#isExpanding
        Type: Boolean
        Default: false

        If <#isMultiline> is set to true, setting <#isExpanding> to true will
        make it automatically expand vertically to fit its contents, rather than
        show a scrollbar.

        This property *must not* be changed after the view has been rendered.
    */
    isExpanding: false,

    /**
        Property: O.TextView#isValid
        Type: Boolean
        Default: true

        If false, an `invalid' class will be added to the view's class name.
    */
    isValid: true,

    /**
        Property: O.TextView#isHighlighted
        Type: Boolean
        Default: false

        If true, a `highlight` class will be added to the view's class name.
        This is a styling hook for highlighting the view, e.g. if it fails
        validation.
    */
    isHighlighted: false,

    /**
        Property: O.TextView#inputType
        Type: String
        Default: "text"

        The type property for the <input> DOM node (e.g. "password", "tel" etc.)

        This property *must not* be changed after the view has been rendered.
    */
    inputType: 'text',

    /**
        Property: O.TextView#placeholder
        Type: String
        Default: ''

        Placeholder text to be displayed in the text input when it is empty.
    */
    placeholder: '',

    /**
        Property: O.TextView#value
        Type: String
        Default: ''

        The value currently input in the text field.
    */
    value: '',

    /**
        Property: O.TextView#inputAttributes
        Type: Object

        Extra attributes to add to the text view. Examples include:

        - maxLength: Number
        - autocomplete: 'on' or 'off'
        - autocapitalize: 'on' or 'off'
        - autocorrect: 'on' or 'off'
        - pattern: String (regexp)
    */
    inputAttributes: {
        autocomplete: 'off'
    },

    /**
        Property: O.TextView#selection
        Type: Object

        When used as a getter, this will return an object with two properties:

        start - {Number} The number of characters offset from the beginning of
                the text that the selection starts.
        end   - {Number} The number of characters offset from the beginning of
                the text that the selection ends.

        Note, if there is no selection, the start and end values will be the
        same, and give the position of the cursor.

        When used as a setter, you can give it an object as described above to
        set the selection, or if you just want to give it a cursor position, you
        can pass a number instead.

        Note, this property is *not observable* and cannot be used to monitor
        changes in selection/cursor position.

    */
    selection: function ( selection ) {
        var control = this._domControl,
            isNumber = ( typeof selection === 'number' ),
            start = selection ? isNumber ?
                    selection : selection.start : 0,
            end = selection ? isNumber ?
                    selection : selection.end || start : start;
        if ( selection !== undefined ) {
            // Ensure any value changes have been drawn.
            this.redraw();
            // Firefox will throw an error if the control is not actually in the
            // document when trying to set the selection. There might be other
            // situations where it does so as well, so just using a try/catch to
            // guard against all.
            try {
                control.setSelectionRange( start, end );
            } catch ( error ) {}
        } else {
            // Firefox sometimes throws an error if you try to read the
            // selection. Again, probably if the control is not actually in the
            // document.
            try {
                start = control.selectionStart;
                end = control.selectionEnd;
            } catch ( error ) {}
        }
        return selection || {
            start: start,
            end: end
        };
    }.property().nocache(),

    /**
        Property: O.TextView#blurOnEscape
        Type: Boolean
        Default: true

        If true, if the user is focussed in the text view and hits the escape
        key, the focus will be removed.
    */
    blurOnEscape: true,

    // --- Render ---

    /**
        Property: O.TextView#allowTextSelection
        Type: Boolean
        Default: true

        Overrides default in <O.View#allowTextSelection>.
    */
    allowTextSelection: true,

    /**
        Property: O.TextView#type
        Type: String

        Will be added to the view's class name.
    */
    type: '',

    /**
        Property: O.TextView#className
        Type: String

        Overrides default in <O.View#className>. Will have the class `v-Text`,
        and any classes given in the <#type> property, along with the following
        other class names dependent on state:

        is-highlight - The <#isHighlighted> property is true.
        is-focussed  - The <#isFocussed> property is true.
        is-invalid   - The <#isValid> property is false.
        is-disabled  - The <#isDisabled> property is true.
    */
    className: function () {
        var type = this.get( 'type' );
        return 'v-Text' +
            ( this.get( 'isHighlighted' ) ? ' is-highlighted' : '' ) +
            ( this.get( 'isFocussed' ) ? ' is-focussed' : '' ) +
            ( this.get( 'isValid' ) ? '' : ' is-invalid' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' ) +
            ( type ? ' ' + type : '' );
    }.property( 'type', 'isHighlighted',
        'isFocussed', 'isValid', 'isDisabled' ),

    layerStyles: function () {
        return NS.extend({
            position: this.get( 'positioning' ),
            display: this.get( 'isMultiline' ) ? 'block' : 'inline-block',
            cursor: 'text',
            userSelect: 'text'
        }, this.get( 'layout' ) );
    }.property( 'layout', 'positioning' ),

    /**
        Method: O.TextView#draw

        Overridden to draw view. See <O.View#draw>.
    */
    draw: function ( layer, Element, el ) {
        var value = this.get( 'value' ),
            placeholder = this.get( 'placeholder' ),
            isMultiline = this.get( 'isMultiline' ),
            control = this._domControl = el(
                isMultiline ? 'textarea' : 'input', {
                    id: this.get( 'id' ) + '-input',
                    className: 'v-Text-input',
                    rows: isMultiline ? '1' : undefined,
                    name: this.get( 'name' ),
                    type: this.get( 'inputType' ),
                    disabled: this.get( 'isDisabled' ),
                    tabIndex: this.get( 'tabIndex' ),
                    value: value
                });

        this.redrawInputAttributes();

        if ( placeholder ) {
            if ( nativePlaceholder ) {
                control.placeholder = placeholder;
            } else if ( !value ) {
                this._placeholderShowing = true;
                NS.Element.addClass( control, 'v-Text-input--placeholder' );
                control.value = placeholder;
            }
        }

        layer.title = this.get( 'tooltip' );

        return [
            this._domLabel = el( 'span', [ this.get( 'label' ) ] ),
            control
        ];
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.TextView#textNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    textNeedsRedraw: function ( self, property, oldValue ) {
        var isValue = ( property === 'value' );
        if ( !isValue || !this._settingFromInput ) {
            this.propertyNeedsRedraw( self, property, oldValue );
        }
        if ( isValue && this.get( 'isExpanding' ) ) {
            this.propertyNeedsRedraw( self, 'textHeight', oldValue );
        }
    }.observes( 'value', 'placeholder', 'inputAttributes' ),

    /**
        Method: O.TextView#redrawValue

        Updates the content of the `<textarea>` or `<input>` to match the
        <#value> property.
    */
    redrawValue: function () {
        var value = this.get( 'value' );
        this._domControl.value = value;
        // Ensure placeholder is updated.
        if ( !nativePlaceholder && !this.get( 'isFocussed' ) ) {
            this._setPlaceholder();
        }
    },

    /**
        Method: O.TextView#redrawPlaceholder

        Updates the placeholder text in the DOM when the <#placeholder> property
        changes.
    */
    redrawPlaceholder: function () {
        var placeholder = this.get( 'placeholder' ),
            control = this._domControl;
        if ( nativePlaceholder ) {
            control.placeholder = placeholder;
        } else if ( this._placeholderShowing ) {
            control.value = placeholder;
        }
    },

    /**
        Method: O.TextView#redrawInputAttributes

        Updates any other properties of the `<input>` element.
    */
    redrawInputAttributes: function () {
        var inputAttributes = this.get( 'inputAttributes' ),
            control = this._domControl,
            property;
        for ( property in inputAttributes ) {
            control.set( property, inputAttributes[ property ] );
        }
    },

    redrawTextHeight: function () {
        var control = this._domControl,
            style = control.style,
            scrollView = this.getParent( NS.ScrollView ),
            scrollHeight;
        // Set to auto to collapse it back to one line, otherwise it would
        // never shrink if you delete text.
        style.height = 'auto';
        scrollHeight = control.scrollHeight;
        // Presto returns 0 immediately after appending to doc.
        if ( scrollHeight ) {
            style.height = scrollHeight + 'px';
        }
        // Collapsing the height will mess with the scroll, so make sure we
        // reset the scroll position back to what it was.
        if ( scrollView ) {
            scrollView.redrawScroll();
        }
    },

    // --- Activate ---

    /**
        Method: O.TextView#activate

        Overridden to focus the text view. See <O.AbstractControlView#activate>.
    */
    activate: function () {
        this.focus();
    },

    // --- Scrolling and focus ---

    savedSelection: null,

    /**
        Method: O.TextView#didEnterDocument

        Overridden to restore scroll position and selection. See
        <O.View#didEnterDocument>.
    */
    didEnterDocument: function () {
        TextView.parent.didEnterDocument.call( this );
        if ( this.get( 'isExpanding' ) ) {
            this.redrawTextHeight();
        }
        // Restore scroll positions:
        if ( this.get( 'isMultiline' ) ) {
            var control = this._domControl,
                left = this.get( 'scrollLeft' ),
                top = this.get( 'scrollTop' );
            if ( left ) { control.scrollLeft = left; }
            if ( top ) { control.scrollTop = top; }
            control.addEventListener( 'scroll', this, false );
        }
        var selection = this.get( 'savedSelection' );
        if ( selection ) {
            this.set( 'selection', selection ).focus();
        }
        return this;
    },

    /**
        Method: O.TextView#willLeaveDocument

        Overridden to save scroll position and selection. See
        <O.View#willLeaveDocument>.
    */
    willLeaveDocument: function () {
        // If focussed, save cursor position
        if ( this.get( 'isFocussed' ) ) {
            this.set( 'savedSelection', this.get( 'selection' ) );
            this.blur();
        }
        // Stop listening for scrolls:
        if ( this.get( 'isMultiline' ) ) {
            this._domControl.removeEventListener( 'scroll', this, false );
        }
        return TextView.parent.willLeaveDocument.call( this );
    },

    /**
        Method (private): O.TextView#_syncBackScrolls

        Sets the <O.View#scrollLeft> and <O.View#scrollTop> properties whenever
        the user scrolls the textarea.

        Parameters:
            event - {Event} The scroll event.
    */
    _syncBackScrolls: function ( event ) {
        var control = this._domControl,
            left = control.scrollLeft,
            top = control.scrollTop;

        this.beginPropertyChanges()
            .set( 'scrollLeft', left )
            .set( 'scrollTop', top )
        .endPropertyChanges();

        event.stopPropagation();
    }.on( 'scroll' ),

    // --- Keep state in sync with render ---

    /**
        Method: O.TextView#syncBackValue

        Updates the <#value> property when the user interacts with the textarea.

        Parameters:
            event - {Event} The input event.
    */
    syncBackValue: function () {
        this._settingFromInput = true;
        if ( nativePlaceholder || !this._placeholderShowing ) {
            this.set( 'value', this._domControl.value );
        }
        this._settingFromInput = false;
    }.on( 'input' ),

    /**
        Method (private): O.TextView#_setPlaceholder

        Sets/removes the placholder text for browsers that don't support this
        natively.
    */
    _setPlaceholder: nativePlaceholder ? null :
    function ( _, __, ___, isFocussed ) {
        var control = this._domControl,
            placeholder;
        if ( isFocussed ) {
            if ( this._placeholderShowing ) {
                this._placeholderShowing = false;
                NS.Element.removeClass( control, 'v-Text-input--placeholder' );
                control.value = '';
            }
        } else {
            placeholder = this.get( 'placeholder' );
            if ( placeholder && !this.get( 'value' ) ) {
                this._placeholderShowing = true;
                NS.Element.addClass( control, 'v-Text-input--placeholder' );
                control.value = placeholder;
            }
        }
    }.observes( 'isFocussed' ),

    /**
        Method (private): O.TextView#_onClick

        Focus and set selection to the end.

        Parameters:
            event - {Event} The click event.
    */
    _onClick: function ( event ) {
        if ( event.target === this.get( 'layer' ) ) {
            this.set( 'selection', this.get( 'value' ).length )
                .focus();
        }
    }.on( 'click' ),

    /**
        Method (private): O.TextView#_onKeypress

        Stop IE automatically focussing the nearest button when the user hits
        enter in single line text inputs.

        Parameters:
            event - {Event} The keypress event.
    */
    _onKeypress: function ( event ) {
        var key = ( event.keyCode || event.which );
        // If key == enter, IE will automatically focus the nearest button
        // (presumably as though it were submitting the form). Stop this.
        if ( key === 13 && !this.get( 'isMultiline' ) ) {
            event.preventDefault();
        }
    }.on( 'keypress' ),

    /**
        Method (private): O.TextView#_blurOnEsc

        Blur the text area when the user hits escape, provided the
        <#blurOnEscape> property is set to `true`.

        Parameters:
            event - {Event} The keydown event.
    */
    _blurOnEsc: function ( event ) {
        var key = ( event.keyCode || event.which );
        // If key == esc, we want to blur. Not all browsers do this
        // automatically.
        if ( key === 27 && this.get( 'blurOnEscape' ) ) {
            this.blur();
        }
    }.on( 'keydown' )
});

if ( 8 <= NS.UA.msie && NS.UA.msie <= 9 ) {
    TextView.implement({
        _ieSyncBackValue: function ( event ) {
            var key = event.type === 'cut' ?
                'delete' : NS.DOMEvent.lookupKey( event );
            // IE9 fails to fire the input event on deletion of content.
            // IE8 fails to fire the propertychange event on deletion
            // and also if only a single character input (at least after a
            // deletion)
            if ( NS.UA.msie === 8 || key === 'backspace' || key === 'delete' ) {
                this.fire( 'input' );
            }
        }.on( 'keyup', 'cut' )
    });
}

NS.TextView = TextView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: SearchTextView.js                                                    \\
// Module: ControlViews                                                       \\
// Requires: TextView.js                                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var SearchTextView = NS.Class({

    Extends: NS.TextView,

    type: 'v-SearchText',

    draw: function ( layer, Element, el ) {
        var children =
                SearchTextView.parent.draw.call( this, layer, Element, el );
        children.push(
            el( 'i.icon.icon-search' ),
            new NS.ButtonView({
                type: NS.bind( this, 'value', function ( value ) {
                    return value ?
                        'v-SearchText-reset v-Button--iconOnly' : 'u-hidden';
                }),
                icon: 'icon-clear',
                positioning: 'absolute',
                label: NS.loc( 'Clear Search' ),
                shortcut: 'ctrl-/',
                target: this,
                method: 'reset'
            })
        );
        return children;
    },

    reset: function () {
        this.set( 'value', '' )
            .blur();
    }
});

NS.SearchTextView = SearchTextView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: SelectView.js                                                        \\
// Module: ControlViews                                                       \\
// Requires: Core, Foundation, DOM, View, AbstractControlView.js              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Class: O.SelectView

    Extends: O.AbstractControlView

    A view representing an HTML `<select>` menu. The `value` property is two-way
    bindable, representing the selected option.
*/
var SelectView = NS.Class({

    Extends: NS.AbstractControlView,

    /**
        Property: O.SelectView#options
        Type: Array

        The array of options to present in the select menu. Each item in the
        array should be an object, with the following properties:

        text       - {String} The text to display for the item
        value      - {*} The value for the <O.SelectView#value> property to take
                     when this item is selected.
        isDisabled - {Boolean} (optional) If true, the option will be disabled
                     (unselectable). Defaults to false if not present.
    */
    options: [],

    // --- Render ---

    type: '',

    /**
        Property: O.SelectView#className
        Type: String
        Default: 'v-Select'

        Overrides default in <O.View#className>.
    */
    className: function () {
        var type = this.get( 'type' );
        return 'v-Select' +
            ( this.get( 'isFocussed' ) ? ' is-focussed' : '' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' ) +
            ( type ? ' ' + type : '' );
    }.property( 'type', 'isFocussed', 'isDisabled' ),

    /**
        Method: O.SelectView#draw

        Overridden to draw select menu in layer. See <O.View#draw>.
    */
    draw: function ( layer, Element, el ) {
        var control = this._domControl =
            this._drawSelect( this.get( 'options' ) );
        return [
            SelectView.parent.draw.call( this, layer, Element, el ),
            control
        ];
    },

    /**
        Method (private): O.SelectView#_drawSelect

        Creates the DOM elements for the `<select>` and all `<option>` children.

        Parameters:
            options - {Array} Array of option objects.

        Returns:
            {Element} The `<select>`.
    */
    _drawSelect: function ( options ) {
        var selected = this.get( 'value' ),
            el = NS.Element.create,
            select = el( 'select', {
                className: 'v-Select-input',
                disabled: this.get( 'isDisabled' )
            },
                options.map( function ( option, i ) {
                    return el( 'option', {
                        text: option.text,
                        value: i,
                        selected: option.value === selected,
                        disabled: !!option.isDisabled
                    });
                })
            );
        return select;
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.SelectView#selectNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    selectNeedsRedraw: function ( self, property, oldValue ) {
       return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'options', 'value' ),

    /**
        Method: O.SelectView#redrawOptions

        Updates the DOM representation when the <O.SelectView#options> property
        changes.
    */
    redrawOptions: function ( layer, oldOptions ) {
        var options = this.get( 'options' ),
            select;
        if ( !NS.isEqual( options, oldOptions ) ) {
            select = this._drawSelect( options );
            layer.replaceChild( select, this._domControl );
            this._domControl = select;
        }
    },

    /**
        Method: O.SelectView#redrawValue

        Selects the corresponding option in the select when the
        <O.SelectView#value> property changes.
    */
    redrawValue: function () {
        var value = this.get( 'value' ),
            options = this.get( 'options' ),
            l = options.length;

        while ( l-- ) {
            if ( options[l].value === value ) {
                this._domControl.value = l + '';
                return;
            }
        }
        // Work around Chrome on Android bug where it doesn't redraw the
        // select control until the element blurs.
        if ( this.get( 'isFocussed' ) ) {
            this.blur().focus();
        }
    },

    // --- Keep state in sync with render ---

    /**
        Method: O.SelectView#syncBackValue

        Observes the `change` event to update the view's `value` property when
        the user selects a different option.
    */
    syncBackValue: function () {
        var i = this._domControl.selectedIndex;
        this.set( 'value', this.get( 'options' ).getObjectAt( i ).value );
    }.on( 'change' )
});

NS.SelectView = SelectView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ListItemView.js                                                      \\
// Module: CollectionViews                                                    \\
// Requires: Core, Foundation, View                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var ListItemView = NS.Class({

    Extends: NS.View,

    content: null,

    index: 0,
    itemHeight: 32,

    selection: null,
    isSelected: false,

    animateIn: false,

    init: function ( mixin ) {
        var selection = mixin.selection,
            content = mixin.content;
        if ( selection && content ) {
            this.isSelected = selection.isIdSelected(
                content.get( 'id' )
            );
        }
        ListItemView.parent.init.call( this, mixin );
    },

    positioning: 'absolute',

    layout: ( NS.UA.cssProps.transform3d ? function () {
        var index = this.get( 'index' ),
            itemHeight = this.get( 'itemHeight' ),
            isNew = this.get( 'animateIn' ) && !this.get( 'isInDocument' ),
            y = ( index - ( isNew ? 1 : 0 ) ) * itemHeight;
        return {
            transform: 'translate3d(0,' + y + 'px,0)',
            opacity: isNew ? 0 : 1
        };
    } : function () {
        var index = this.get( 'index' ),
            itemHeight = this.get( 'itemHeight' );
        return {
            top: index * itemHeight
        };
    }).property( 'index', 'itemHeight' ),

    resetLayout: function () {
        if ( this.get( 'animateIn' ) ) {
            this.computedPropertyDidChange( 'layout' );
        }
    }.nextFrame().observes( 'isInDocument' )
});

NS.ListItemView = ListItemView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ListKBFocusView.js                                              \\
// Module: CollectionViews                                                    \\
// Requires: Core, Foundation, View                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS, undefined ) {

var ListKBFocusView = NS.Class({

    Extends: NS.View,

    selection: null,
    singleSelection: null,

    index: NS.bind( 'singleSelection*index' ),
    record: NS.bind( 'singleSelection*record' ),

    itemHeight: 32,

    keys: {
        j: 'goNext',
        k: 'goPrev',
        x: 'select',
        'shift-x': 'select',
        o: 'trigger',
        enter: 'trigger',
        s: 'star'
    },

    className: 'v-ListKBFocus',

    positioning: 'absolute',

    layout: function () {
        var itemHeight = this.get( 'itemHeight' ),
            index = this.get( 'index' ),
            singleSelection = this.get( 'singleSelection' ),
            list = singleSelection.get( 'content' );
        if ( index > -1 && list &&
                list.getObjectAt( index ) !== this.get( 'record' ) ) {
            index = -1;
        }
        return {
            top: itemHeight * index,
            height: index < 0 ? 0 : itemHeight
        };
    }.property( 'itemHeight', 'index', 'record' ),

    didEnterDocument: function () {
        var keys = this.get( 'keys' ),
            shortcuts = NS.ViewEventsController.kbShortcuts,
            key;
        for ( key in keys ) {
            shortcuts.register( key, this, keys[ key ] );
        }
        this.checkInitialScroll();
        return ListKBFocusView.parent.didEnterDocument.call( this );
    },
    willLeaveDocument: function () {
        var keys = this.get( 'keys' ),
            shortcuts = NS.ViewEventsController.kbShortcuts,
            key;
        for ( key in keys ) {
            shortcuts.deregister( key, this, keys[ key ] );
        }
        return ListKBFocusView.parent.willLeaveDocument.call( this );
    },

    // Scroll to centre widget on screen with no animation
    checkInitialScroll: function () {
        if ( this.get( 'distanceFromVisRect' ) ) {
            this.scrollIntoView( 0, false );
        }
    }.queue( 'after' ),

    checkScroll: function () {
        var distance = this.get( 'distanceFromVisRect' );
        if ( distance ) {
            this.scrollIntoView( distance < 0 ? -0.6 : 0.6, true );
        }
    }.queue( 'after' ),

    distanceFromVisRect: function () {
        var scrollView = this.getParent( NS.ScrollView );
        if ( scrollView ) {
            var scrollTop = scrollView.get( 'scrollTop' ),
                layout = this.get( 'layout' ),
                top = layout.top,
                above = top - scrollTop;

            if ( above < 0 ) { return above; }

            var scrollHeight = scrollView.get( 'pxHeight' ),
                below = top + layout.height - scrollTop - scrollHeight;

            if ( below > 0 ) { return below; }
        }
        return 0;
    }.property().nocache(),

    scrollIntoView: function ( offset, withAnimation ) {
        var scrollView = this.getParent( NS.ScrollView );
        if ( scrollView ) {
            var scrollHeight = scrollView.get( 'pxHeight' ),
                layout = this.get( 'layout' ),
                itemHeight = layout.height,
                top = layout.top;

            if ( offset && -1 <= offset && offset <= 1 ) {
                offset = ( offset * ( scrollHeight - itemHeight ) ) >> 1;
            }
            scrollView.scrollTo( 0,
                Math.max( 0,
                    top +
                    ( ( itemHeight - scrollHeight ) >> 1 ) +
                    ( offset || 0 )
                ),
                withAnimation
            );
        }
    },

    go: function ( delta ) {
        var index = this.get( 'index' ),
            singleSelection = this.get( 'singleSelection' ),
            list = singleSelection.get( 'content' ),
            length = list && list.get( 'length' ) || 0;
        if ( delta === 1 && index > -1 && list &&
                list.getObjectAt( index ) !== this.get( 'record' ) ) {
            delta = 0;
        }
        if ( delta ) {
            singleSelection.set( 'index',
                ( index + delta ).limit( 0, length - 1 ) );
        } else {
            singleSelection.propertyDidChange( 'index' );
        }
        if ( this.get( 'isInDocument' ) ) {
            this.checkScroll();
        }
    },
    goNext: function () {
        this.go( 1 );
    },
    goPrev: function () {
        this.go( -1 );
    },
    select: function ( event ) {
        var index = this.get( 'index' ),
            selection = this.get( 'selection' ),
            record = this.get( 'record' );
        // Check it's next to a loaded record.
        if ( selection && record ) {
            selection.selectIndex( index,
                !selection.isIdSelected( record.get( 'id' ) ),
                event.shiftKey );
        }
    },
    trigger: function () {},
    star: function () {}
});

NS.ListKBFocusView = ListKBFocusView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ListView.js                                                          \\
// Module: CollectionViews                                                    \\
// Requires: Core, Foundation, View                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var byIndex = function ( a, b ) {
    return a.get( 'index' ) - b.get( 'index' );
};
var addToTable = function ( array, table ) {
    var i, l;
    for ( i = 0, l = array.length; i < l; i += 1 ) {
        table[ array[i] ] = true;
    }
    return table;
};

var ListView = NS.Class({

    Extends: NS.View,

    content: null,
    contentLength: NS.bind( 'content.length' ),

    renderInOrder: true,

    ItemView: null,
    itemHeight: 0,

    init: function ( mixin ) {
        this._added = null;
        this._removed = null;
        this._rendered = {};
        this._renderRange = {
            start: 0,
            end: 0x7fffffff // Max positive signed 32bit int: 2^31 - 1
        };

        this.selection = null;

        ListView.parent.init.call( this, mixin );

        var selection = this.get( 'selection' );
        if ( selection ) {
            selection.set( 'view', this );
        }
    },

    destroy: function () {
        if ( this.get( 'isRendered' ) ) {
            var content = this.get( 'content' );
            if ( content ) {
                content.removeObserverForRange(
                    this._renderRange, this, '_redraw' );
                content.off( 'query:updated', this, 'contentWasUpdated' );
            }
        }
        ListView.parent.destroy.call( this );
    },

    contentDidChange: function ( _, __, oldVal, newVal ) {
        if ( this.get( 'isRendered' ) ) {
            var range = this._renderRange;
            if ( oldVal ) {
                oldVal.removeObserverForRange( range, this, '_redraw' );
                oldVal.off( 'query:updated', this, 'contentWasUpdated' );
            }
            if ( newVal ) {
                newVal.addObserverForRange( range, this, '_redraw' );
                newVal.on( 'query:updated', this, 'contentWasUpdated' );
            }
            this._redraw();
        }
    }.observes( 'content' ),

    contentWasUpdated: function ( event ) {
        if ( this.get( 'isInDocument' ) ) {
            this._added = addToTable( event.added, this._added || {} );
            this._removed = addToTable( event.removed, this._removed || {} );
        }
    },

    layout: function () {
        var itemHeight = this.get( 'itemHeight' );
        return itemHeight ? {
            height: itemHeight * ( this.get( 'contentLength' ) || 0 )
        } : {};
    }.property( 'itemHeight', 'contentLength' ),

    draw: function ( layer, Element/*, el*/ ) {
        // Render any unmanaged child views first.
        var children = ListView.parent.draw.call( this, layer ),
            content = this.get( 'content' );
        if ( children ) {
            Element.appendChildren( layer, children );
        }
        if ( content ) {
            content.addObserverForRange( this._renderRange, this, '_redraw' );
            content.on( 'query:updated', this, 'contentWasUpdated' );
            this.redrawLayer( layer );
        }
    },

    _redraw: function () {
        this.propertyNeedsRedraw( this, 'layer' );
    },

    // -----------------------------------------------------------------------

    isCorrectItemView: function ( view, item ) {
        return view.get( 'content' ) === item;
    },

    createItemView: function ( content, index, list, isAdded ) {
        var ItemView = this.get( 'ItemView' );
        return new ItemView({
            parentView: this,
            content: content,
            index: index,
            list: list,
            isAdded: isAdded,
            selection: this.get( 'selection' )
        });
    },

    destroyItemView: function ( view ) {
        view.destroy();
    },

    calculateDirtyRange: function ( list, start, end ) {
        var lastExistingView = null,
            childViews = this.get( 'childViews' ),
            l = childViews.length,
            view, item;
        while ( end && l ) {
            view = childViews[ l - 1 ];
            item = list.getObjectAt( end - 1 );
            if ( !this.isCorrectItemView( view, item, end - 1 ) ) {
                break;
            }
            lastExistingView = view;
            l -= 1;
            end -= 1;
        }
        while ( start < end && start < l ) {
            view = childViews[ start ];
            item = list.getObjectAt( start );
            if ( !this.isCorrectItemView( view, item, start ) ) {
                break;
            }
            start += 1;
        }
        return [ start, end, lastExistingView ];
    },

    redrawLayer: function ( layer ) {
        var list = this.get( 'content' ) || [],
            childViews = this.get( 'childViews' ),

            // Limit to this range in the content array.
            renderRange = this._renderRange,
            renderInOrder = this.get( 'renderInOrder' ),

            start = Math.max( 0, renderRange.start ),
            end = Math.min( list.get( 'length' ), renderRange.end ),

            dirty, dirtyStart, dirtyEnd,
            lastExistingView = null,

            // Set of already rendered views.
            rendered = this._rendered,
            newRendered = {},
            viewsToInsert = [],

            // Are they new or always been there?
            added = this._added,
            removed = this._removed,

            isInDocument = this.get( 'isInDocument' ),
            frag = layer.ownerDocument.createDocumentFragment(),

            i, l, item, id, view, isAdded, isRemoved, viewToInsert,
            renderedViewIds;

        // If we have to keep the DOM order the same as the list order, we'll
        // have to remove existing views from the DOM. To optimise this, we
        // check from both ends whether the views are already correct.
        if ( renderInOrder ) {
            dirty = this.calculateDirtyRange( list, start, end );
            dirtyStart = dirty[0];
            dirtyEnd = dirty[1];
            lastExistingView = dirty[2];
        }

        // Mark views we still need.
        for ( i = start, l = end; i < l; i += 1 ) {
            item = list.getObjectAt( i );
            id = item ? NS.guid( item ) : 'null:' + i;
            view = rendered[ id ];
            if ( view && this.isCorrectItemView( view, item, i ) ) {
                newRendered[ id ] = view;
            }
        }

        // Remove ones which are no longer needed
        this.beginPropertyChanges();
        renderedViewIds = Object.keys( rendered );
        for ( i = 0, l = renderedViewIds.length; i < l; i += 1 ) {
            id = renderedViewIds[i];
            view = rendered[ id ];
            if ( !newRendered[ id ] ) {
                isRemoved = removed && ( item = view.get( 'content' ) ) ?
                    removed[ item.get( 'id' ) ] : false;
                view.detach( isRemoved );
                this.destroyItemView( view );
            }
        }
        this._rendered = newRendered;

        // Create/update views in render range
        for ( i = start, l = end; i < l; i += 1 ) {
            item = list.getObjectAt( i );
            id = item ? NS.guid( item ) : 'null:' + i;
            view = newRendered[ id ];
            if ( !view ) {
                isAdded = added && item ? added[ item.get( 'id' ) ] : false;
                view = this.createItemView( item, i, list, isAdded );
                if ( view ) {
                    newRendered[ id ] = view;
                    childViews.include( view );
                }
                // If reusing views, may not need to reinsert.
                viewToInsert = !!view && !view.get( 'isInDocument' );
            } else {
                viewToInsert = ( renderInOrder &&
                    i >= dirtyStart && i < dirtyEnd );
                if ( viewToInsert ) {
                    if ( isInDocument ) {
                        view.willLeaveDocument();
                    }
                    layer.removeChild( view.get( 'layer' ) );
                    if ( isInDocument ) {
                        view.didLeaveDocument();
                    }
                }
                view.set( 'index', i )
                    .set( 'list', list );
            }
            if ( viewToInsert ) {
                frag.appendChild( view.render().get( 'layer' ) );
                if ( isInDocument ) {
                    view.willEnterDocument();
                }
                viewsToInsert.push( view );
            }
        }

        // Append new views to layer
        if ( viewsToInsert.length ) {
            if ( lastExistingView ) {
                layer.insertBefore( frag, lastExistingView.get( 'layer' ) );
            } else {
                layer.appendChild( frag );
            }
            if ( isInDocument ) {
                for ( i = 0, l = viewsToInsert.length; i < l; i += 1 ) {
                    viewsToInsert[i].didEnterDocument();
                }
            }
        }

        if ( renderInOrder ) {
            childViews.sort( byIndex );
        }

        this._added = null;
        this._removed = null;
        this.propertyDidChange( 'childViews' );
        this.endPropertyChanges();
    },

    // --- Can't add views by hand; just bound to content ---

    insertView: null,
    replaceView: null
});

NS.ListView = ListView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: TrueVisibleRect.js                                                   \\
// Module: CollectionViews                                                    \\
// Requires: Core, Foundation, View                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

/**
    Mixin: O.TrueVisibleRect

    The TrueVisibleRect mixin can be added to view classes to make the
    <O.View#visibleRect> property take into account clipping by the parent view.
    This is more expensive, so should only be used in classes where this is
    absolutely necessary, for example in <O.ProgressiveListView>, where it is
    used to only render the visible portion of a potentially very long list.
*/
NS.TrueVisibleRect = {

    visibleRect: function () {
        // Ignore any changes whilst not in the DOM
        if ( !this.get( 'isInDocument' ) ) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        // Calculate current visible rect.
        var x = this.get( 'pxLeft' ),
            y = this.get( 'pxTop' ),
            width = this.get( 'pxWidth' ),
            height = this.get( 'pxHeight' ),
            parent = this.get( 'parentView' ).get( 'visibleRect' ),

            left = Math.max( x, parent.x ),
            right = Math.min( x + width, parent.x + parent.width ),
            top = Math.max( y, parent.y ),
            bottom = Math.min( y + height, parent.y + parent.height ),
            across = Math.max( right - left, 0 ),
            down = Math.max( bottom - top, 0 );

        return {
            x: left - x + this.get( 'scrollLeft' ),
            y: top - y + this.get( 'scrollTop' ),
            width: across,
            height: down
        };
    }.property( 'scrollTop', 'scrollLeft',
        'pxLayout', 'parentView.visibleRect', 'isInDocument' )
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ProgressiveListView.js                                               \\
// Module: CollectionViews                                                    \\
// Requires: View, ListView.js, TrueVisibleRect.js                            \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var ProgressiveListView = NS.Class({

    Extends: NS.ListView,

    Mixin: NS.TrueVisibleRect,

    renderInOrder: false,
    batchSize: 10,
    triggerInPx: 200,

    init: function ( mixin ) {
        ProgressiveListView.parent.init.call( this, mixin );
        this._renderRange.end = 0;
    },

    contentWasUpdated: function ( event ) {
        var scrollView = this.getParent( NS.ScrollView );
        if ( scrollView ) {
            // Update scroll view correctly.
            var itemHeight = this.get( 'itemHeight' ),
                y = Math.max( this.get( 'visibleRect' ).y, 0 ),
                // Index of first item rendered
                top = ~~( y / itemHeight ),
                removedIndexes = event.removedIndexes,
                addedIndexes = event.addedIndexes,
                rendered = this._rendered,
                change = 0,
                i, l, id, view;

            // If we are within 3 items of the top, don't change anything.
            // The new items will push down the old so you will see the change.
            // Otherwise, adjust the scroll to make it appear as though it
            // hasn't changed when the new items are inserted above, so a flood
            // of items doesn't stop you from viewing a section of the list.
            if ( top > 2 ) {
                for ( i = 0, l = removedIndexes.length; i < l; i += 1 ) {
                    if ( removedIndexes[i] < top ) { change -= 1; }
                    // Guaranteed in ascending order.
                    else { break; }
                }
                top += change;
                for ( i = 0, l = addedIndexes.length; i < l; i += 1 ) {
                    if ( addedIndexes[i] <= top ) { change += 1; }
                    // Guaranteed in ascending order.
                    else { break; }
                }
            }
            if ( change ) {
                for ( id in rendered ) {
                    view = rendered[ id ];
                    view.set( 'animateLayer', false )
                        .set( 'index', view.get( 'index' ) + change )
                        .redraw()
                        .set( 'animateLayer', true );
                }
                scrollView.scrollBy( 0, change * itemHeight );
                scrollView.redraw();
            }
        }
        return ProgressiveListView.parent.contentWasUpdated.call( this, event );
    },

    _simulateScroll: function ( _, __, oldLength, length ) {
        // Convert null/undefined length to 0.
        if ( !length ) { length = 0; }
        // In IE or Opera, if the scrollTop of the containing overflowed div was
        // past the new maximum scrollTop, then although it correctly changes
        // to the new maximum scrollTop, no scroll event is fired. Therefore we
        // have to simulate this firing in the next event loop.
        if ( length < oldLength ) {
            NS.RunLoop.invokeInNextEventLoop(
                this.fire.bind( this, 'scroll', null, null )
            );
        }
    }.observes( 'contentLength' ),

    visibleRectDidChange: function () {
        // We only care about changes when we're visible.
        if ( this.get( 'isInDocument' ) ) {
            var visible = this.get( 'visibleRect' ),
                extension = this.get( 'triggerInPx' ),
                batchSize = this.get( 'batchSize' ),
                height = this.get( 'itemHeight' ) * batchSize,
                y = visible.y,
                // Index of first item we want rendered
                start = Math.max( 0,
                    ~~( ( y - extension ) / height ) * batchSize ),
                // Index of last item we want rendered
                end = ~~( ( y + visible.height + extension ) / height ) *
                    batchSize + batchSize,
                _renderRange = this._renderRange;

            if ( start !== _renderRange.start || end !== _renderRange.end ) {
                _renderRange.start = start;
                _renderRange.end = end;
                this._redraw();
            }
        }
    }.queue( 'middle' ).observes( 'visibleRect', 'itemHeight' )
});

NS.ProgressiveListView = ProgressiveListView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: SwitchView.js                                                        \\
// Module: CollectionViews                                                    \\
// Requires: Core, Foundation, View                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global document */

( function ( NS ) {

var View = NS.View;
var Element = NS.Element;

var forEachView = function ( views, method, args ) {
    var l = views ? views.length : 0,
        view;
    while ( l-- ) {
        view = views[l];
        if ( view instanceof View && !view.isDestroyed ) {
            if ( args ) {
                view[ method ].apply( view, args );
            } else {
                view[ method ]();
            }
        }
    }
};

var flattenAndPrune = function ( array, node ) {
    if ( node instanceof Array ) {
        node.reduce( flattenAndPrune, array );
    } else if ( node ) {
        array.push( node );
    }
    return array;
};

var SwitchView = NS.Class({

    Extends: View,

    init: function ( mixin ) {
        this._oldView = null;
        // -1 => Not added views to parent
        // Otherwise => Index of view(s) currently in parent
        this._index = -1;

        // Index of view that should be in parent.
        this.index = 0;
        this.views = [];
        this.subViews = [];

        SwitchView.parent.init.call( this, mixin );

        this.isRendered = true;

        var views = this.get( 'views' ),
            l = views.length,
            view;
        while ( l-- ) {
            view = views[l];
            if ( view && !( view instanceof Array ) ) {
                views[l] = [ view ];
            }
        }
    },

    destroy: function () {
        var views = this.get( 'views' ),
            l = views.length;
        while ( l-- ) {
            forEachView( views[l], 'destroy' );
        }
        views = this.get( 'subViews' );
        l = views.length;
        while ( l-- ) {
            forEachView( views[l], 'destroy' );
        }
        SwitchView.parent.destroy.call( this );
    },

    // ---

    layer: function () {
        return document.createComment( 'SwitchView ' + this.get( 'id' ) );
    }.property(),

    willEnterDocument: function () {
        this.resumeBindings();
        this.redraw();
        return this;
    },

    didEnterDocument: function () {
        if ( this.get( 'index' ) !== this._index ) {
            this.switchNeedsRedraw();
        }
        return this.set( 'isInDocument', true );
    },

    willLeaveDocument: function () {
        return this.set( 'isInDocument', false );
    },

    didLeaveDocument: function () {
        return this.suspendBindings();
    },

    // ---

    redraw: function () {
        var oldIndex = this._index,
            newIndex = this.get( 'index' ),
            parentView;
        // If not yet added to parent, nothing to redraw; _add will be called
        // automatically soon.
        if ( !this.isDestroyed && oldIndex > -1 && oldIndex !== newIndex ) {
            parentView = this.get( 'parentView' );
            if ( parentView ) {
                this._remove( parentView );
                this._add();
            }
        }
    },

    switchNeedsRedraw: function () {
        if ( this.get( 'isInDocument' ) ) {
            NS.RunLoop.queueFn( 'render', this.redraw, this );
        }
    }.observes( 'index' ),

    parentViewDidChange: function ( _, __, oldParent, newParent ) {
        if ( oldParent ) {
            // May be a NOP, but just in case.
            oldParent.removeObserverForKey( 'childViews', this, '_add' );
            this._remove( oldParent );
        }
        if ( newParent ) {
            if ( newParent.get( 'isRendered' ) &&
                    !this.get( 'layer' ).parentNode ) {
                // We need to wait until we've been inserted to know where our
                // DOM marker has been place, and so where to insert the real
                // view(s).
                newParent.addObserverForKey( 'childViews', this, '_add' );
            } else {
                // If not rendered, just add our views in the right place in the
                // parent's childView list. They'll be rendered in the right
                // spot.
                this._add();
            }
        }
    }.observes( 'parentView' ),

    _add: function () {
        var index = this.get( 'index' ),
            views = this.get( 'views' )[ index ],
            subViews = this.get( 'subViews' )[ index ],
            parent = this.get( 'parentView' ),
            isInDocument = parent.get( 'isInDocument' ),
            position = this.get( 'layer' ),
            layer = position.parentNode,
            l, node, before;

        // May be a NOP, but just in case.
        parent.removeObserverForKey( 'childViews', this, '_add' );
        if ( this._index !== -1 ) {
            return;
        }
        this._index = index;

        if ( subViews ) {
            forEachView( subViews, 'set', [ 'parentView', parent ] );
            if ( isInDocument ) {
                forEachView( subViews, 'willEnterDocument' );
            }
        }

        l = views ? views.length : 0;
        while ( l-- ) {
            node = views[l];
            if ( node instanceof View ) {
                parent.insertView( node, this, 'after' );
            } else {
                if ( typeof node !== 'object' ) {
                    node = views[l] = document.createTextNode( node );
                }
                before = position.nextSibling;
                if ( before ) {
                    layer.insertBefore( node, before );
                } else {
                    layer.appendChild( node );
                }
            }
        }

        if ( subViews ) {
            if ( isInDocument ) {
                forEachView( subViews, 'didEnterDocument' );
            }
            Array.prototype.push.apply( parent.get( 'childViews' ), subViews );
            parent.propertyDidChange( 'childViews' );
        }
    },

    _remove: function ( parent ) {
        var oldIndex = this._index,
            views = this.get( 'views' )[ oldIndex ],
            subViews = this.get( 'subViews' )[ oldIndex ],
            isInDocument = parent.get( 'isInDocument' ),
            l, node, childViews, view, index, numToRemove;

        if ( isInDocument && subViews ) {
            forEachView( subViews, 'willLeaveDocument' );
        }

        l = views ? views.length : 0;
        while ( l-- ) {
            node = views[l];
            if ( node instanceof View ) {
                parent.removeView( node );
            } else {
                node.parentNode.removeChild( node );
            }
        }

        if ( subViews ) {
            if ( isInDocument ) {
                forEachView( subViews, 'didLeaveDocument' );
            }
            forEachView( subViews, 'set', [ 'parentView', null ] );
            childViews = parent.get( 'childViews' );
            l = subViews.length;
            while ( l-- ) {
                view = subViews[l];
                index = childViews.lastIndexOf( view );
                numToRemove = 1;
                if ( index > -1 ) {
                    while ( l > 0 && index > 0 &&
                            subViews[ l - 1 ] === childViews[ index - 1 ] ) {
                        l -= 1;
                        index -= 1;
                        numToRemove += 1;
                    }
                    childViews.splice( index, numToRemove );
                }
            }
            parent.propertyDidChange( 'childViews' );
        }
        this._index = -1;
    },

    // ---

    /*
        If views are inside el() methods, they will call this method. Collect
        them up, then pass them as subViews when show() or otherwise() is
        called.
    */
    insertView: function ( view, parentNode ) {
        this.childViews.push( view );
        var oldParent = view.get( 'parentView' );
        if ( oldParent ) {
            oldParent.removeView( view );
        }
        parentNode.appendChild( view.render().get( 'layer' ) );
        return this;
    },

    _addCondition: function ( view, index ) {
        view = view ?
            view instanceof Array ?
                view :
                [ view ] :
            null;
        this.views[ index ] = view && view.reduce( flattenAndPrune, [] );
        var subViews = this.childViews;
        if ( subViews.length ) {
            this.subViews[ index ] = subViews;
            this.childViews = [];
        }
        return this;
    },

    show: function ( view ) {
        return this._addCondition( view, 0 );
    },

    otherwise: function ( view ) {
        return this._addCondition( view, 1 );
    },

    end: function () {
        Element.forView( this._oldView );
        this._oldView = null;
        return this;
    }
});

NS.SwitchView = SwitchView;

var pickViewWhen = function ( bool ) {
    return bool ? 0 : 1;
};
var pickViewUnless = function ( bool ) {
    return bool ? 1 : 0;
};

var createView = function ( object, property, transform ) {
    var switchView = new SwitchView({
        index: NS.bind( object, property, transform )
    });
    switchView._oldView = Element.forView( switchView );
    return switchView;
};

Element.when = function ( object, property, transform ) {
    var pickView = transform ? function ( value, syncForward ) {
        return pickViewWhen( transform( value, syncForward ) );
    } : pickViewWhen;
    return createView( object, property, pickView );
};
Element.unless = function ( object, property, transform ) {
    var pickView = transform ? function ( value, syncForward ) {
        return pickViewUnless( transform( value, syncForward ) );
    } : pickViewUnless;
    return createView( object, property, pickView );
};

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ToolbarView.js                                                       \\
// Module: CollectionViews                                                    \\
// Requires: Core, Foundation, View, ControlViews                             \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var toView = function ( name ) {
    return ( name === '-' ) ?
        NS.Element.create( 'span.v-Toolbar-divider' ) :
        this._views[ name ];
};

var OverflowMenuView = NS.Class({

    Extends: NS.MenuButtonView,

    didEnterDocument: function () {
        OverflowMenuView.parent.didEnterDocument.call( this );
        this.setShortcuts( null, '', {}, this.get( 'shortcuts' ) );
        return this;
    },

    willLeaveDocument: function () {
        this.setShortcuts( null, '', this.get( 'shortcuts' ), {} );
        return OverflowMenuView.parent.willLeaveDocument.call( this );
    },

    shortcuts: function () {
        var views = this.getFromPath( 'menuView.options' );
        return views ? views.reduce( function ( acc, view ) {
            var shortcut = view.get( 'shortcut' );
            if ( shortcut ) {
                shortcut.split( ' ' ).forEach( function ( key ) {
                    acc[ key ] = view;
                });
            }
            return acc;
        }, {} ) : {};
    }.property( 'menuView' ),

    setShortcuts: function ( _, __, oldShortcuts, shortcuts ) {
        if ( this.get( 'isInDocument' ) ) {
            var kbShortcuts = NS.ViewEventsController.kbShortcuts,
                key;
            if ( !shortcuts ) { shortcuts = this.get( 'shortcuts' ); }
            for ( key in oldShortcuts ) {
                kbShortcuts.deregister( key, this, 'activateButton' );
            }
            for ( key in shortcuts ) {
                kbShortcuts.register( key, this, 'activateButton' );
            }
        }
    }.observes( 'shortcuts' ),

    activateButton: function ( event ) {
        var key = NS.DOMEvent.lookupKey( event ),
            button = this.get( 'shortcuts' )[ key ];
        if ( button instanceof NS.MenuButtonView ) {
            this.activate();
        }
        button.activate();
    }
});

var ToolbarView = NS.Class({

    Extends: NS.View,

    className: 'v-Toolbar',

    config: 'standard',
    minimumGap: 20,
    preventOverlap: false,

    init: function ( mixin ) {
        ToolbarView.parent.init.call( this, mixin );
        this._views = {
            overflow: new OverflowMenuView({
                label: NS.loc( 'More' ),
                popOverView: mixin.popOverView || new NS.PopOverView()
            })
        };
        this._configs = {
            standard: {
                left: [],
                right: []
            }
        };
        this._measureView = null;
        this._widths = {};
    },

    registerView: function ( name, view, _dontMeasure ) {
        this._views[ name ] = view;
        if ( !_dontMeasure && this.get( 'isInDocument' ) &&
                this.get( 'preventOverlap' ) ) {
            this.preMeasure().postMeasure();
        }
        return this;
    },

    registerViews: function ( views ) {
        for ( var name in views ) {
            this.registerView( name, views[ name ], true );
        }
        if ( this.get( 'isInDocument' ) && this.get( 'preventOverlap' ) ) {
            this.preMeasure().postMeasure();
        }
        return this;
    },

    registerConfig: function ( name, config ) {
        this._configs[ name ] = config;
        if ( this.get( 'config' ) === name ) {
            this.computedPropertyDidChange( 'config' );
        }
        return this;
    },

    registerConfigs: function ( configs ) {
        for ( var name in configs ) {
            this.registerConfig( name, configs[ name ] );
        }
        return this;
    },

    getView: function ( name ) {
        return this._views[ name ];
    },

    // ---

    leftConfig: function () {
        var configs = this._configs,
            config = configs[ this.get( 'config' ) ];
        return ( config && config.left ) || configs.standard.left;
    }.property( 'config' ),

    rightConfig: function () {
        var configs = this._configs,
            config = configs[ this.get( 'config' ) ];
        return ( config && config.right ) || configs.standard.right;
    }.property( 'config' ),

    left: function () {
        var leftConfig = this.get( 'leftConfig' ),
            rightConfig = this.get( 'rightConfig' ),
            pxWidth = this.get( 'pxWidth' ),
            widths = this._widths,
            i, l;

        if ( widths && pxWidth && this.get( 'preventOverlap' ) ) {
            pxWidth -= this.get( 'minimumGap' );
            for ( i = 0, l = rightConfig.length; i < l; i += 1 ) {
                pxWidth -= widths[ rightConfig[i] ];
            }
            for ( i = 0, l = leftConfig.length; i < l; i += 1 ) {
                pxWidth -= widths[ leftConfig[i] ];
            }
            if ( pxWidth < 0 ) {
                pxWidth -= widths[ '-' ];
                pxWidth -= widths.overflow;

                while ( pxWidth < 0 && l-- ) {
                    pxWidth += widths[ leftConfig[l] ];
                }
                if ( l < 0 ) { l = 0; }

                this._views.overflow.set( 'menuView', new NS.MenuView({
                    showFilter: false,
                    options: leftConfig.slice( l )
                        .map( toView, this )
                        .filter( function ( view ) {
                            return view instanceof NS.View;
                        })
                }) );

                if ( l > 0 ) {
                    if ( leftConfig[ l - 1 ] === '-' ) {
                        l -= 1;
                    }
                    leftConfig = leftConfig.slice( 0, l );
                    leftConfig.push( '-' );
                    leftConfig.push( 'overflow' );
                } else {
                    leftConfig = [ 'overflow' ];
                    l = 0;
                }
            }
        }
        return leftConfig.map( toView, this );
    }.property( 'leftConfig', 'rightConfig', 'pxWidth' ),

    right: function () {
        return this.get( 'rightConfig' ).map( toView, this );
    }.property( 'rightConfig' ),

    preMeasure: function () {
        this.insertView( this._measureView =
            new NS.View({
                className: 'v-Toolbar-section v-Toolbar-section--measure',
                layerStyles: {},
                childViews: Object.values( this._views )
                                  .filter( function ( view ) {
                    return !view.get( 'parentView' );
                }),
                draw: function ( layer, Element, el ) {
                    return [
                        el( 'span.v-Toolbar-divider' ),
                        NS.View.prototype.draw.call( this, layer, Element, el )
                    ];
                }
            }),
            this.get( 'layer' ).lastChild,
            'before'
        );
        return this;
    },

    postMeasure: function () {
        var widths = this._widths,
            views = this._views,
            measureView = this._measureView,
            unused = measureView.get( 'childViews' ),
            container = measureView.get( 'layer' ),
            containerBoundingClientRect = container.getBoundingClientRect(),
            firstButton = unused.length ? unused[0].get( 'layer' ) : null,
            name, l;

        for ( name in views ) {
            widths[ name ] = views[ name ].get( 'pxWidth' ) || widths[ name ];
        }

        // Want to include any left/right margin, so get difference between
        // edge of first button and start of container
        widths[ '-' ] = ( firstButton ?
            firstButton.getBoundingClientRect().left :
            containerBoundingClientRect.right
        ) - containerBoundingClientRect.left;

        this.removeView( measureView );
        l = unused.length;
        while ( l-- ) {
            measureView.removeView( unused[l] );
        }
        measureView.destroy();
        this._measureView = null;

        return this;
    },

    willEnterDocument: function () {
        if ( this.get( 'preventOverlap' ) ) {
            this.preMeasure();
        }
        return ToolbarView.parent.willEnterDocument.call( this );
    },

    didEnterDocument: function () {
        this.beginPropertyChanges();
        ToolbarView.parent.didEnterDocument.call( this );
        if ( this.get( 'preventOverlap' ) ) {
            this.postMeasure();
        }
        this.endPropertyChanges();
        return this;
    },

    draw: function ( layer, Element, el ) {
        return [
            el( 'div.v-Toolbar-section.v-Toolbar-section--left',
                this.get( 'left' )
            ),
            el( 'div.v-Toolbar-section.v-Toolbar-section--right',
                this.get( 'right' )
            )
        ];
    },

    toolbarNeedsRedraw: function ( self, property, oldValue ) {
       return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'left', 'right' ),

    redrawLeft: function ( layer, oldViews ) {
        this.redrawSide( layer.firstChild, oldViews, this.get( 'left' ) );
    },
    redrawRight: function ( layer, oldViews ) {
        this.redrawSide( layer.lastChild, oldViews, this.get( 'right' ) );
    },

    redrawSide: function ( container, oldViews, newViews ) {
        var View = NS.View,
            start = 0,
            isEqual = true,
            i, l, view, parent;

        for ( i = start, l = oldViews.length; i < l; i += 1 ) {
            view = oldViews[i];
            if ( view instanceof View ) {
                if ( isEqual && view === newViews[i] ) {
                    start += 1;
                } else {
                    isEqual = false;
                    // Check it hasn't already swapped sides!
                    if ( view.get( 'layer' ).parentNode === container ) {
                        this.removeView( view );
                    }
                }
            } else {
                if ( isEqual && !( newViews[i] instanceof View ) ) {
                    start += 1;
                    newViews[i] = view;
                } else {
                    container.removeChild( view );
                }
            }
        }
        for ( i = start, l = newViews.length; i < l; i += 1 ) {
            view = newViews[i];
            if ( view instanceof View ) {
                if ( parent = view.get( 'parentView' ) ) {
                    parent.removeView( view );
                }
                this.insertView( view, container );
            } else {
                container.appendChild( view );
            }
        }
    }
});

NS.ToolbarView = ToolbarView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: ScrollView.js                                                        \\
// Module: ContainerViews                                                     \\
// Requires: Core, Foundation, View                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var ScrollAnimation = NS.Class({

    Extends: NS.Animation,

    duration: 250,

    prepare: function ( coordinates ) {
        var object = this.object,
            startX = this.startX = object.get( 'scrollLeft' ),
            startY = this.startY = object.get( 'scrollTop' ),
            endX = this.endX = coordinates.x || 0,
            endY = this.endY = coordinates.y || 0,
            deltaX = this.deltaX = endX - startX,
            deltaY = this.deltaY = endY - startY;

        return !!( deltaX || deltaY );
    },

    drawFrame: function ( position ) {
        var x = position < 1 ?
                this.startX + ( position * this.deltaX ) : this.endX,
            y = position < 1 ?
                this.startY + ( position * this.deltaY ) : this.endY;
        this.object._scrollTo( x, y );
    }
});

/**
    Class: O.ScrollView

    Extends: O.View

    An O.ScrollView instance is a fixed size container, which can be scrolled if
    its contents overflows the bounds of the view. By default, a scrollbar will
    only be shown for vertical overflow. Set the <O.ScrollView#showScrollbarX>
    property to `true` to show a scrollbar on horizontal overflow as well.
*/
var ScrollView = NS.Class({

    Extends: NS.View,


    /**
        Property: O.ScrollView#showScrollbarX
        Type: Boolean
        Default: false

        Show a scrollbar if the content horizontally overflows the bounds of the
        DOM element representing this view?
    */
    showScrollbarX: false,

    /**
        Property: O.ScrollView#showScrollbarY
        Type: Boolean
        Default: true

        Show a scrollbar if the content vertically overflows the bounds of the
        DOM element representing this view?
    */
    showScrollbarY: true,

    /**
        Property: O.ScrollView#positioning
        Type: String
        Default: 'absolute'

        Overrides default in <O.View#positioning>.
   */
    positioning: 'absolute',

    /**
        Property: O.ScrollView#layout
        Type: Object
        Default:
                {
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%'
                }

        Overrides default in <O.View#layout>.
    */
    layout: NS.View.LAYOUT_FILL_PARENT,

    /**
        Property: O.ScrollView#layerStyles
        Type: Object

        Sets the overflow styles to show the scrollbars.
    */
    layerStyles: function () {
        var styles = NS.View.prototype.layerStyles.call( this );
        styles.overflowX = this.get( 'showScrollbarX' ) ? 'auto' : 'hidden';
        styles.overflowY = this.get( 'showScrollbarY' ) ? 'auto' : 'hidden';
        styles.WebkitOverflowScrolling = 'touch';
        return styles;
    }.property( 'layout', 'allowTextSelection', 'positioning',
        'showScrollbarX', 'showScrollbarY' ),

    /**
        Property: O.ScrollView#keys
        Type: Object
        Default: {}

        Keyboard shortcuts to scroll the view. A map of keyboard shortcut to the
        method name to call on the O.ScrollView instance. These shortcuts will
        automatically be activated/deactivated when the view is added/removed
        to/from the document.

        For example, on the main scroll view for you content, you might set:

            {
                'pagedown': 'scrollPage',
                'pageup': 'reverseScrollPage',
                'space': 'scrollPage',
                'shift-space': 'reverseScrollPage',
                'down': 'scrollLine',
                'up': 'reverseScrollLine'
            }
    */
    keys: {},

    didCreateLayer: function ( layer ) {
        this.scrollLayer = layer;
    },

    didEnterDocument: function () {
        this.get( 'scrollLayer' ).addEventListener( 'scroll', this, false );

        // Add keyboard shortcuts:
        var keys = this.get( 'keys' ),
            shortcuts = NS.ViewEventsController.kbShortcuts,
            key;
        for ( key in keys ) {
            shortcuts.register( key, this, keys[ key ] );
        }

        return ScrollView.parent.didEnterDocument.call( this );
    },

    willLeaveDocument: function () {
        // Remove keyboard shortcuts:
        var keys = this.get( 'keys' ),
            shortcuts = NS.ViewEventsController.kbShortcuts,
            key;
        for ( key in keys ) {
            shortcuts.deregister( key, this, keys[ key ] );
        }

        this.get( 'scrollLayer' ).removeEventListener( 'scroll', this, false );

        return ScrollView.parent.willLeaveDocument.call( this );
    },

    _restoreScroll: function () {
        // Scroll is reset to 0 in some browsers whenever it is removed from the
        // DOM, so we need to set it to what it should be.
        if ( this.get( 'isInDocument' ) ) {
            var layer = this.get( 'scrollLayer' );
            layer.scrollLeft = this.get( 'scrollLeft' );
            layer.scrollTop = this.get( 'scrollTop' );
        }
    }.queue( 'render' ).observes( 'isInDocument' ),

    /**
        Property: O.ScrollView#scrollAnimation
        Type: O.Animation

        An <O.Animation> object to animate scrolling on this object. Normally
        you will not need to interact with this directly, but just set the
        `withAnimation` argument to `true` when you call O.ScrollView#scrollTo.
        However, if you wish to change the duration or easing method, you can do
        so by setting it on this object.
    */
    scrollAnimation: function ( ) {
        return new ScrollAnimation({
            object: this
        });
    }.property(),

    /**
        Method: O.ScrollView#scrollPage

        Scrolls the view down by the view height - 50px.
    */
    scrollPage: function () {
        return this.scrollBy( 0, this.get( 'pxHeight' ) - 50, true );
    },

    /**
        Method: O.ScrollView#reverseScrollPage

        Scrolls the view up by the view height - 50px.
    */
    reverseScrollPage: function () {
        return this.scrollBy( 0, 50 - this.get( 'pxHeight' ), true );
    },

    /**
        Method: O.ScrollView#scrollLine

        Scrolls the view down by 40px.
    */
    scrollLine: function () {
        return this.scrollBy( 0, 40 );
    },

    /**
        Method: O.ScrollView#reverseScrollLine

        Scrolls the view up by 40px.
    */
    reverseScrollLine: function () {
        return this.scrollBy( 0, -40 );
    },

    /**
        Method: O.ScrollView#scrollBy

        Scroll the view by the given number of pixels (use negative values to
        scroll up/left).

        Parameters:
            x             - {Number} The number of pixels to scroll right.
            y             - {Number} The number of pixels to scroll down.
            withAnimation - {Boolean} (optional) If true, animate the scroll.

        Returns:
            {Boolean} Did the view actually scroll (false if already at end)?
    */
    scrollBy: function ( x, y, withAnimation ) {
        var left = this.get( 'scrollLeft' ),
            top = this.get( 'scrollTop' );
        x += left;
        y += top;

        this.scrollTo( x, y, withAnimation );

        return top !== this.get( 'scrollTop' ) ||
            left !== this.get( 'scrollLeft' );
    },

    /**
        Method: O.ScrollView#scrollToView

        Scroll the view to show a sub-view in the top left of the view.

        Parameters:
            view          - {View} The sub-view to scroll to.
            offset        - {Object} (optional) If supplied, must contain
                            numerical `x` and `y` properties which give the
                            number of pixels to offset the subview from the top
                            left of the scroll view.
            withAnimation - {Boolean} (optional) If true, animate the scroll.

        Returns:
            {O.ScrollView} Returns self.
    */
    scrollToView: function ( view, offset, withAnimation ) {
        var position = view.getPositionRelativeTo( this );
        return this.scrollTo(
            position.left + ( offset && offset.x || 0 ),
            position.top + ( offset && offset.y || 0 ),
            withAnimation
        );
    },

    /**
        Method: O.ScrollView#scrollBy

        Scroll the view to a given position, where (0,0) represents the scroll
        view fully .

        Parameters:
            x             - {Number} The number of pixels to set the horizontal
                            scroll-position to.
            y             - {Number} The number of pixels to set the vertical
                            scroll-position to.
            withAnimation - {Boolean} (optional) If true, animate the scroll.

        Returns:
            {O.ScrollView} Returns self.
    */
    scrollTo: function ( x, y, withAnimation ) {
        // Can't have negative scroll values.
        if ( x < 0 ) { x = 0; }
        if ( y < 0 ) { y = 0; }

        var scrollAnimation = this.get( 'scrollAnimation' );
        scrollAnimation.stop();

        if ( withAnimation ) {
            scrollAnimation.animate({
                x: x,
                y: y
            });
        } else {
            this.beginPropertyChanges()
                .set( 'scrollLeft', x )
                .set( 'scrollTop', y )
                .propertyNeedsRedraw( this, 'scroll' )
            .endPropertyChanges();
        }
        return this;
    },

    /**
        Method (private): O.ScrollView#_scrollTo

        Set the new values and immediately redraw. Fast path for animation.
    */
    _scrollTo: function ( x, y ) {
        this.set( 'scrollLeft', x )
            .set( 'scrollTop', y );
        this.redrawScroll();
    },

    /**
        Method: O.ScrollView#redrawScroll

        Redraws the scroll position in the layer to match the view's state.
    */
    redrawScroll: function () {
        var layer = this.get( 'scrollLayer' ),
            x = this.get( 'scrollLeft' ),
            y = this.get( 'scrollTop' );
        layer.scrollLeft = x;
        layer.scrollTop = y;
        // In case we've gone past the end.
        if ( x || y ) {
            NS.RunLoop.queueFn( 'after', this.syncBackScroll, this );
        }
    },

    /**
        Method: O.ScrollView#syncBackScroll

        Parameters:
            event - {Event} (optional) The scroll event object.

        Updates the view properties when the layer scrolls.
    */
    syncBackScroll: function ( event ) {
        if ( this._needsRedraw ) {
            return;
        }
        var layer = this.get( 'scrollLayer' ),
            x = layer.scrollLeft,
            y = layer.scrollTop;
        this.beginPropertyChanges()
            .set( 'scrollLeft', x )
            .set( 'scrollTop', y )
            .endPropertyChanges();
        if ( event ) {
            event.stopPropagation();
            // Don't interpret tap to stop scroll as a real tap.
            if ( NS.Tap ) {
                NS.Tap.cancel();
            }
        }
    }.on( 'scroll' )
});

if ( NS.UA.isIOS ) {
    ScrollView.implement({
        isFixedDimensions: function () {
            var positioning = this.get( 'positioning' );
            return positioning === 'absolute' || positioning === 'fixed';
        }.property( 'positioning' ),

        draw: function ( layer, Element, el ) {
            var isFixedDimensions = this.get( 'isFixedDimensions' ),
                scrollFixerHeight = 1,
                wrapper = null,
                safariVersion = NS.UA.safari,
                children;

            // Render the children.
            children = ScrollView.parent.draw.call( this, layer, Element, el );

            // Trick 1: The dual overflow:scroll view.
            // By default, iOS Safari will scroll the containing scroll view
            // if you are at the top/bottom of an overflow:scroll view. This
            // means it scrolls the window instead of bouncing your scroll view.
            // The dual overflow:scroll fixes this in iOS < 8. You only need
            // this in Safari: if in a UIWebView you can disable the natural
            // scrolling of the window.
            if ( 0 < safariVersion && safariVersion < 8 ) {
                wrapper = this.scrollLayer = el( 'div', {
                    style: 'position:relative;height:100%;' +
                        '-webkit-overflow-scrolling:touch;' +
                        'overflow-x:' +
                            ( this.get( 'showScrollbarX' ) ?
                                'auto;' : 'hidden;' ) +
                        'overflow-y:' +
                            ( this.get( 'showScrollbarY' ) ?
                                'auto;' : 'hidden;' )
                });
                layer.appendChild( wrapper );
                layer = wrapper;
            }

            // Trick 2: Never leave the scroll view at the ends.
            // As Trick 1 doesn't work in Safari on iOS8, we have to use a more
            // crude method: ensure the scrollHeight is at least pxHeight + 2,
            // then make sure scrollTop is never at the absolute end, so there
            // is always room to scroll in both directions. We add a 1px tall
            // empty div at the top of the content so at scrollTop=1px, it
            // looks like it should.
            if ( safariVersion >= 8 ) {
                scrollFixerHeight = 2;
                layer.appendChild(
                    el( 'div', { style: 'height:1px' } )
                );
                this.on( 'scroll', this, '_setNotAtEnd' )
                    .addObserverForKey( 'isInDocument', this, '_setNotAtEnd' );
            }

            // Append the actual children of the scroll view.
            Element.appendChildren( layer, children );

            // Trick 3: Ensuring the view scrolls.
            // Following platform conventions, we assume a fixed height
            // ScrollView should always scroll, regardless of whether the
            // content is taller than the view, whereas a variable height
            // ScrollView just needs to scroll if the content requires it.
            // Therefore, if it's a fixed height view, we add an extra
            // invisible div permanently 1px below the height, so it always
            // has scrollable content.
            if ( isFixedDimensions ) {
                layer.appendChild(
                    el( 'div', {
                        style: 'position:absolute;top:100%;left:0px;' +
                            'width:1px;height:' + scrollFixerHeight + 'px;'
                    })
                );
            }
        },

        _setNotAtEnd: function () {
            if ( this.get( 'isInDocument' ) ) {
                var scrollTop = this.get( 'scrollTop' ),
                    scrollLeft = this.get( 'scrollLeft' );
                if ( !scrollTop ) {
                    this.scrollTo( scrollLeft, 1 );
                } else if ( scrollTop + this.get( 'pxHeight' ) ===
                        this.get( 'layer' ).scrollHeight ) {
                    this.scrollTo( scrollLeft, scrollTop - 1 );
                }
            }
        }.queue( 'after' ),

        preventRootScroll: function ( event ) {
            if ( !this.get( 'isFixedDimensions' ) ) {
                var layer = this.get( 'layer' );
                if ( layer.scrollHeight <= layer.offsetHeight ) {
                    event.preventDefault();
                }
            }
        }.on( 'touchmove' ),

        insertView: function ( view, relativeTo, where ) {
            if ( !relativeTo && this.get( 'isRendered' ) ) {
                relativeTo = this.scrollLayer;
                if ( where === 'top' ) {
                    if ( NS.UA.safari >= 8 ) {
                        relativeTo = relativeTo.firstChild;
                        where = 'after';
                    }
                } else if ( where === 'bottom' ) {
                    if ( this.get( 'isFixedDimensions' ) ) {
                        relativeTo = relativeTo.lastChild;
                        where = 'before';
                    }
                }
            }
            return ScrollView.parent.insertView.call(
                this, view, relativeTo, where );
        }
    });
}

NS.ScrollView = ScrollView;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: SplitViewController.js                                               \\
// Module: ContainerViews                                                     \\
// Requires: Core, Foundation, View                                           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var VERTICAL = 1;
var HORIZONTAL = 2;
var TOP_LEFT = 4;
var BOTTOM_RIGHT = 8;

var auto = 'auto';

/**
    Class: O.SplitViewController

    Extends: O.Object
*/
var SplitViewController = NS.Class({

    Extends: NS.Object,

    /**
        Property: O.SplitViewController#direction
        Type: Number
        Default: O.SplitViewController.VERTICAL

        The direction to split the view, either `O.SplitViewController.VERTICAL`
        (the default) or `O.SplitViewController.HORIZONTAL`.
    */
    direction: VERTICAL,

    /**
        Property: O.SplitViewController#flex
        Type: Number
        Default: O.SplitViewController.TOP_LEFT

        Which of the two panes should be the flexible one. Must be either
        `O.SplitViewController.TOP_LEFT` (default - the top pane is flexible if
        horizontally split, or the left pane is flexible if vertically split) or
        `O.SplitViewController.BOTTOM_RIGHT` (the right or bottom pane is
        flexible).
    */
    flex: TOP_LEFT,

    /**
        Property: O.SplitViewController#flex
        Type: Number
        Default: 200

        The number of pixels the static pane is wide/tall (depending on split
        direction).
    */
    staticPaneLength: 200,

    /**
        Property: O.SplitViewController#minStaticPaneLength
        Type: Number
        Default: 0

        The minimum width/height (in pixels) that the static pane may be resized
        to.
    */
    minStaticPaneLength: 0,

    /**
        Property: O.SplitViewController#maxStaticPaneLength
        Type: Number
        Default: 0

        The maximum width/height (in pixels) that the static pane may be resized
        to.
    */
    maxStaticPaneLength: 32767,

    /**
        Property: O.SplitViewController#topLeftLayout
        Type: Object

        The layout properties to use to position the top/left pane.
    */
    topLeftLayout: function ( layout ) {
        var flexDir = this.get( 'direction' ),
            flexPane = this.get( 'flex' ),
            staticLength = this.get( 'staticPaneLength' );
        return layout || {
            top: 0,
            left: 0,
            right: ( flexDir === VERTICAL &&
                flexPane === TOP_LEFT ) ? staticLength : auto,
            width: flexDir === HORIZONTAL ? '100%' :
                flexPane === TOP_LEFT ? auto : staticLength,
            bottom: ( flexDir === HORIZONTAL &&
                flexPane === TOP_LEFT ) ? staticLength : auto,
            height: flexDir === VERTICAL ? '100%' :
                flexPane === TOP_LEFT ? auto : staticLength
        };
    }.property( 'flex', 'direction', 'staticPaneLength' ),

    /**
        Property: O.SplitViewController#bottomRightLayout
        Type: Object

        The layout properties to use to position the bottom/right pane.
    */
    bottomRightLayout: function ( layout ) {
        var flexDir = this.get( 'direction' ),
            flexPane = this.get( 'flex' ),
            staticLength = this.get( 'staticPaneLength' );
        return layout || {
            bottom: 0,
            right: 0,
            left: ( flexDir === VERTICAL &&
                flexPane === BOTTOM_RIGHT ) ? staticLength : auto,
            width: flexDir === HORIZONTAL ? '100%' :
                flexPane === BOTTOM_RIGHT ? auto : staticLength,
            top: ( flexDir === HORIZONTAL &&
                flexPane === BOTTOM_RIGHT ) ? staticLength : auto,
            height: flexDir === VERTICAL ? '100%' :
                flexPane === BOTTOM_RIGHT ? auto : staticLength
        };
    }.property( 'flex', 'direction', 'staticPaneLength' )
});

SplitViewController.extend({
    VERTICAL: VERTICAL,
    HORIZONTAL: HORIZONTAL,
    TOP_LEFT: TOP_LEFT,
    BOTTOM_RIGHT: BOTTOM_RIGHT
});

NS.SplitViewController = SplitViewController;

}( O ) );


// -------------------------------------------------------------------------- \\
// File: SplitViewDivider.js                                                  \\
// Module: ContainerViews                                                     \\
// Requires: Core, Foundation, View, DragDrop, SplitViewController.js         \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

( function ( NS ) {

var VERTICAL = NS.SplitViewController.VERTICAL;

/**
    Class: O.SplitDividerView

    Extends: O.View

    Includes: O.Draggable

    An O.SplitDividerView instance represents the divide between two panes
    controllered by an <O.SplitViewController> instance. It can be dragged to
    resize the static pane in the split view.
*/
var SplitDividerView = NS.Class({

    Extends: NS.View,

    Mixin: NS.Draggable,

    /**
        Property: O.SplitDividerView#className
        Type: String
        Default: 'v-SplitDivider'

        Overrides default in O.View#className.
    */
    className: 'v-SplitDivider',

    /**
        Property: O.SplitDividerView#thickness
        Type: Number
        Default: 10

        How many pixels wide (if vertical split) or tall (if horizontal split)
        the view should be. Note, by default the view is invisible, so this
        really represents the hit area for dragging.
    */
    thickness: 10,

    /**
        Property: O.SplitDividerView#controller
        Type: O.SplitViewController

        The controller for the split view.
    */

    /**
        Property: O.SplitDividerView#offset
        Type: Number

        Bound two-way to the <O.SplitViewController#staticPaneLength>. It is
        the distance from the edge of the split view that the split divider
        view should be positioned.
    */
    offset: NS.bindTwoWay( 'controller.staticPaneLength' ),

    /**
        Property: O.SplitDividerView#min
        Type: Number

        Bound to the <O.SplitViewController#minStaticPaneLength>.
    */
    min: NS.bind( 'controller.minStaticPaneLength' ),

    /**
        Property: O.SplitDividerView#max
        Type: Number

        Bound to the <O.SplitViewController#maxStaticPaneLength>.
    */
    max: NS.bind( 'controller.maxStaticPaneLength' ),

    /**
        Property: O.SplitDividerView#direction
        Type: Number

        Bound to the <O.SplitViewController#direction>.
    */
    direction: NS.bind( 'controller.direction' ),

    /**
        Property: O.SplitDividerView#flex
        Type: Number

        Bound to the <O.SplitViewController#flex>.
    */
    flex: NS.bind( 'controller.flex' ),

    /**
        Property: O.SplitDividerView#anchor
        Type: String

        The CSS property giving the side the <O.SplitDividerView#offset> is from
        (top/left/bottom/right).
    */
    anchor: function () {
        var flexTL = this.get( 'flex' ) === NS.SplitViewController.TOP_LEFT,
            isVertical = this.get( 'direction' ) === VERTICAL;
        return isVertical ?
            ( flexTL ? 'right' : 'left' ) : ( flexTL ? 'bottom' : 'top' );
    }.property( 'flex', 'direction' ),

    /**
        Property: O.SplitDividerView#positioning
        Type: String
        Default: 'absolute'

        Overrides default in O.View#positioning
   */
    positioning: 'absolute',

    /**
        Property: O.SplitDividerView#layout
        Type: Object

        Overrides default in O.View#layout to position the view based on the
        direction, anchor, thickness and offset properties.
    */
    layout: function () {
        var thickness = this.get( 'thickness' ),
            styles;
        if ( this.get( 'direction' ) === VERTICAL ) {
            styles = {
                top: 0,
                bottom: 0,
                width: thickness
            };
        } else {
            styles = {
                left: 0,
                right: 0,
                height: thickness
            };
        }
        styles[ this.get( 'anchor' ) ] =
            this.get( 'offset' ) - ( thickness / 2 );
        return styles;
    }.property( 'direction', 'anchor', 'thickness', 'offset' ),

    /**
        Method: O.SplitDividerView#dragStarted

        Records the offset at the time the drag starts.
    */
    dragStarted: function () {
        this._offset = this.get( 'offset' );
        this._dir = ( this.get( 'direction' ) === VERTICAL ) ? 'x' : 'y';
    },

    /**
        Method: O.SplitDividerView#dragMoved

        Updates the offset property based on the difference between the current
        cursor position and the initial cursor position when the drag started.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dragMoved: function ( drag ) {
        var dir = this._dir,
            delta = drag.get( 'cursorPosition' )[ dir ] -
                drag.get( 'startPosition' )[ dir ];
        this.set( 'offset', ( this._offset + delta ).limit(
            this.get( 'min' ), this.get( 'max' ) ) );
    }
});

NS.SplitDividerView = SplitDividerView;

}( O ) );
