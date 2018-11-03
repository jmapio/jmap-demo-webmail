(function (exports) {
'use strict';

/**
    Module: Core

    The Core module defines 'O', the global namespace to contain this library,
    and augments it with a few helper methods. It also contains extensions to
    the default types and class creation functionality.
*/

/**
    Function: O.meta

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
                    corresponding call to
                    <O.ObservableProps#endPropertyChanges>.
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

var meta = function ( object ) {
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
    Function: O.guid

    Returns a unique ID (within the scope of this instance of the application)
    for the item passed in.

    Parameters:
        item - {*} The item to get an id for.

    Returns:
        {String} The id for the item.
*/
var guids = new WeakMap();
var nextGuid = 0;
var guid = function ( item ) {
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

    var guid = item.__guid__ || guids.get( item );
    if ( !guid ) {
        guid = 'id:' + nextGuid.toString( 36 );
        nextGuid += 1;
        guids.set( item, guid );
    }
    return guid;
};

/**
    Function: O.mixin

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
var mixin = function ( object, extras, doNotOverwrite ) {
    if ( extras ) {
        var force = !doNotOverwrite;
        var metadata;

        for ( var key in extras ) {
            if ( key !== '__meta__' &&
                    ( force || !object.hasOwnProperty( key ) ) ) {
                var old = object[ key ];
                var value = extras[ key ];
                if ( old && old.__teardownProperty__ ) {
                    if ( !metadata ) {
                        metadata = meta( object );
                    }
                    old.__teardownProperty__( metadata, key, object );
                }
                if ( value && value.__setupProperty__ ) {
                    if ( !metadata ) {
                        metadata = meta( object );
                    }
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

    DEPRECATED. Use {Object.assign( base, extras )} instead. Caution: there is
    a difference in semantics: `Object.assign` essentially has `doNotOverride`
    turned off. But frankly, this is what you need in most cases.

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
var extend = function ( base, extras, doNotOverwrite ) {
    if ( window.console && console.warn ) {
        console.warn( 'O.extend is deprecated' );
    }
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
var merge = function ( base, extras ) {
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
var clone = function ( value ) {
    var cloned = value;
    if ( value && typeof value === 'object' ) {
        if ( value instanceof Array ) {
            cloned = [];
            var l = value.length;
            while ( l-- ) {
                cloned[l] = clone( value[l] );
            }
        } else if ( value instanceof Date ) {
            cloned = new Date( value );
        } else {
            cloned = {};
            for ( var key in value ) {
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
var isEqual = function ( a, b ) {
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

        > const MyClass = O.Class({ sayBoo: function (){ alert( 'boo' ); } });
        > let instance = new MyClass();
        > instance.sayBoo(); // Alerts 'boo'.

    Parameters:
        params - {Object} An object containing methods or properties
                 to configure this class.

    Returns:
        {Constructor} The constructor function for the new class.
*/
var Class = function ( params ) {
    var parent = params.Extends;
    if ( 'Extends' in params && typeof parent !== 'function' ) {
        throw new Error( 'Bad O.Class definition: Extends is ' + parent );
    }
    var mixins = params.Mixin;
    var init = params.init || ( parent ?
            function () {
                parent.apply( this, arguments );
            } :
            function () {} );

    if ( parent ) {
        var proto = parent.prototype;
        init.parent = proto;
        init.prototype = Object.create( proto );
        init.prototype.constructor = init;
        delete params.Extends;
    }

    if ( mixins ) {
        if ( !( mixins instanceof Array ) ) {
            mixins = [ mixins ];
        }
        for ( var i = 0, l = mixins.length; i < l; i += 1 ) {
            mixin( init.prototype, mixins[i], false );
        }
        delete params.Mixin;
    }

    mixin( init.prototype, params, false );

    return init;
};

/**
    Method: Function#implement

    Adds a set of methods or other properties to the prototype of a function, so
    all instances will have access to them.

    DEPRECATED. Use {Object.assign( this.prototype, methods )} instead.
    Caution: there is a difference in semantics: `Object.assign` essentially
    has `force` turned on. But frankly, this is what you need in most cases.
    Also, if you were using this method to add anything but functions,
    (a) why were you doing that? and
    (b) you’ll need to use {mixin( this.prototype, methods, !force )} instead.

    Parameters:
        methods - {Object} The methods or properties to add to the prototype.
        force   - {Boolean} Unless this is true, existing methods/properties
                  will not be overwritten.

    Returns:
        {Function} Returns self.
*/
Function.prototype.implement = function ( methods, force ) {
    if ( window.console && console.warn ) {
        console.warn( 'Function#implement is deprecated' );
    }
    mixin( this.prototype, methods, !force );
    return this;
};

/**
    Method: Function#extend

    Adds a set of static methods/properties to the function.

    DEPRECATED. Use {Object.assign( this, methods )} instead.
    Caution: there is a difference in semantics: `Object.assign` essentially
    has `force` turned on. But frankly, this is what you need in most cases.

    Parameters:
        methods - {Object} The methods/properties to add.
        force   - {Boolean} Unless this is true, existing methods/properties
                  will not be overwritten.

    Returns:
        {Function} Returns self.
*/
Function.prototype.extend = function ( methods, force ) {
    if ( window.console && console.warn ) {
        console.warn( 'Function#extend is deprecated' );
    }
    extend( this, methods, !force );
    return this;
};



// TODO(cmorgan/modulify): do something about these exports: Function#implement,
// Function#extend

var splitter =
    /%(\+)?(?:'(.))?(-)?(\d+)?(?:\.(\d+))?(?:\$(\d+))?([%sn@])/g;

Object.assign( String.prototype, {
    /**
        Method: String#runeAt

        Like charAt, but if the index points to an octet that is part of a
        surrogate pair, the whole pair is returned (as a string).

        Parameters:
            index - {Number} The index (in bytes) into the string

        Returns:
            {String} The rune at this index.
    */
    runeAt: function runeAt ( index ) {
        var code = this.charCodeAt( index );

        // Outside bounds
        if ( Number.isNaN( code ) ) {
            return ''; // Position not found
        }

        // Normal char
        if ( code < 0xD800 || code > 0xDFFF ) {
            return this.charAt( index );
        }

        // High surrogate (could change last hex to 0xDB7F to treat high
        // private surrogates as single characters)
        if ( 0xD800 <= code && code <= 0xDBFF ) {
            if ( this.length <= ( index + 1 ) ) {
                // High surrogate without following low surrogate
                return '';
            }
        // Low surrogate (0xDC00 <= code && code <= 0xDFFF)
        } else {
            if ( index === 0 ) {
                // Low surrogate without preceding high surrogate
                return '';
            }
            index -= 1;
        }

        code = this.charCodeAt( index + 1 );
        if ( 0xDC00 > code || code > 0xDFFF ) {
            // Not a valid surrogate pair
            return '';
        }

        return this.charAt( index ) + this.charAt( index + 1 );
    },

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
    format: function format () {
        var arguments$1 = arguments;
        var this$1 = this;

        // Reset RegExp.
        splitter.lastIndex = 0;

        var output = '';
        var i = 0;
        var argIndex = 1;
        var part, toInsert;

        while ( ( part = splitter.exec( this ) ) ) {
            // Add everything between last placeholder and this placeholder
            output += this$1.slice( i, part.index );
            // And set i to point to the next character after the placeholder
            i = part.index + part[0].length;

            // Find argument to subsitute in; either the one specified in
            // (6) or the index of this placeholder.
            var data = arguments$1[
                ( parseInt( part[6], 10 ) || argIndex ) - 1 ];

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
            var padLength = ( part[4] || 0 ) - toInsert.length;
            if ( padLength > 0 ) {
                // Padding character is (2) or a space
                var padChar = part[2] || ' ';
                var padding = padChar;
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
        Method: String#escapeHTML

        Returns the string with the characters <,>,& replaced by HTML entities.

        Returns:
            {String} The escaped string.
    */
    escapeHTML: function escapeHTML () {
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
    escapeRegExp: function escapeRegExp () {
        return this.replace( /([-.*+?^${}()|[\]/\\])/g, '\\$1' );
    },

    /**
        Method: String#capitalise

        Returns this string with the first letter converted to a capital.

        Returns:
            {String} The capitalised string.
    */
    capitalise: function capitalise () {
        return this.charAt( 0 ).toUpperCase() + this.slice( 1 );
    },

    /**
        Method: String#camelCase

        Returns this string with any sequence of a hyphen followed by a
        lower-case letter replaced by the capitalised letter.

        Returns:
            {String} The camel-cased string.
    */
    camelCase: function camelCase () {
        return this.replace( /-([a-z])/g, function ( _, letter ) {
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
    hyphenate: function hyphenate () {
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
    contains: function contains ( string, separator ) {
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
    hash: function hash () {
        var this$1 = this;

        var hash = this.length;
        var remainder = hash & 1;
        var l = hash - remainder;

        for ( var i = 0; i < l; i += 2 ) {
            hash += this$1.charCodeAt( i );
            hash = ( hash << 16 ) ^
                ( ( this$1.charCodeAt( i + 1 ) << 11 ) ^ hash );
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
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21 ];

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
            0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391 ];

        var utf16To8 = function ( string ) {
            var utf8 = '';
            for ( var i = 0, l = string.length; i < l; i += 1 ) {
                var c = string.charCodeAt( i );
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
            var length = string.length;
            var blocks = [ 0 ];
            var i, j, k;
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

            var padding = i + 16 - ( ( ( i + 2 ) % 16 ) || 16 );
            for ( ; i < padding; i += 1 ) {
                blocks[i] = 0;
            }

            // Each char is 8 bits.
            blocks[i] = length << 3;
            blocks[ i + 1 ] = length >>> 29;

            return blocks;
        };

        // Add unsigned 32 bit ints with overflow.
        var add = function ( a, b ) {
            var lsw = ( a & 0xffff ) + ( b & 0xffff );
            var msw = ( a >> 16 ) + ( b >> 16 ) + ( lsw >> 16 );
            return ( msw << 16 ) | ( lsw & 0xffff );
        };

        var leftRotate = function ( a, b ) {
            return ( a << b ) | ( a >>> ( 32 - b ) );
        };

        var hexCharacters = '0123456789abcdef';
        var hex = function ( number ) {
            var string = '';
            for ( var i = 0; i < 32; i += 8 ) {
                string += hexCharacters[ ( number >> i + 4 ) & 0xf ];
                string += hexCharacters[ ( number >> i ) & 0xf ];
            }
            return string;
        };

        return function () {
            var words = stringToWords( utf16To8( this ) );
            var h0 = 0x67452301;
            var h1 = 0xEFCDAB89;
            var h2 = 0x98BADCFE;
            var h3 = 0x10325476;

            for ( var j = 0, l = words.length; j < l; j += 16 ) {
                var a = h0;
                var b = h1;
                var c = h2;
                var d = h3;
                var f = (void 0), g = (void 0), temp = (void 0);

                for ( var i = 0; i < 64; i += 1 ) {
                    if ( i < 16 ) {
                        f = ( b & c ) | ( (~b) & d );
                        g = i;
                    } else if ( i < 32 ) {
                        f = ( d & b ) | ( (~d) & c );
                        g = ( ( 5 * i ) + 1 ) % 16;
                    } else if ( i < 48 ) {
                        f = b ^ c ^ d;
                        g = ( ( 3 * i ) + 5 ) % 16;
                    } else {
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
    }() ),
});

// TODO(cmorgan/modulify): do something about these exports: String#format,
// String#repeat, String#escapeHTML, String#escapeRegExp, String#capitalise,
// String#camelCase, String#hyphenate, String#contains, String#hash, String#md5

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
Number.prototype.limit = function ( min, max ) {
    // +0 is required to unbox 'this' back into a primitive number in IE.
    // Otherwise you get a boxed value, which amongst other things makes 0 a
    // truthy value, leading to all sorts of interesting behaviour...
    return this < min ? min : this > max ? max : this + 0;
};

/**
    Method: Number#mod

    Returns the number mod n.

    Parameters:
        n - {Number}

    Returns:
        {Number} The number mod n.
*/
Number.prototype.mod = function ( n ) {
    var m = this % n;
    return m < 0 ? m + n : m;
};

// TODO(cmorgan/modulify): do something about these exports: Number#limit,
// Number#mod

// Circular but it's… mostly OK. See Overture.js for explanation.
var isLeapYear = function ( year ) {
    return (
        ( ( year % 4 === 0 ) && ( year % 100 !== 0 ) ) || ( year % 400 === 0 )
    );
};
var daysInMonths = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

// eslint-disable-next-line max-len
var dateFormat = /^(\d{4}|[+-]\d{6})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?(?:Z|(?:([+-])(\d{2})(?::(\d{2}))?)?)?)?$/;

Object.assign( Date, {
    fromJSON: function fromJSON ( value ) {
        /*
            /^
            (\d{4}|[+-]\d{6})       // 1. Year
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
                        ([+-])      // 8. +/-
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

    getDaysInMonth: function getDaysInMonth ( month, year ) {
        return ( month === 1 && isLeapYear( year ) ) ?
            29 : daysInMonths[ month ];
    },
    getDaysInYear: function getDaysInYear ( year ) {
        return isLeapYear( year ) ? 366 : 365;
    },
    isLeapYear: isLeapYear,
});

var pad = function ( num, nopad, character ) {
    return ( nopad || num > 9 ? '' : ( character || '0' ) ) + num;
};

var aDay = 86400000; // milliseconds in a day

var duration = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: aDay,
    week: 604800000,
};

Object.assign( Date.prototype, {
    /**
        Method: Date#isToday

        Determines if the point of time represented by the date object is today
        in the current time zone.

        Returns:
            {Boolean} Is the date today?
    */
    isToday: function isToday ( utc ) {
        var now = new Date();
        var date = now.getDate();
        var month = now.getMonth();
        var year = now.getFullYear();
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
    isOnSameDayAs: function isOnSameDayAs ( date, utc ) {
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
    getDayName: function getDayName ( abbreviate, utc ) {
        var names = LocaleController && LocaleController.get(
                ( abbreviate ? 'abbreviatedD' : 'd' ) + 'ayNames' );
        var day = utc ? this.getUTCDay() : this.getDay();
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
    getMonthName: function getMonthName ( abbreviate, utc ) {
        var names = LocaleController && LocaleController.get(
                ( abbreviate ? 'abbreviatedM' : 'm' ) + 'onthNames' );
        var day = utc ? this.getUTCMonth() : this.getMonth();
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
    getDayOfYear: function getDayOfYear ( utc ) {
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
    getWeekNumber: function getWeekNumber ( firstDayOfWeek, utc ) {
        var day = utc ? this.getUTCDay() : this.getDay();
        var dayOfYear = this.getDayOfYear( utc ) - 1; // 0-indexed
        var daysToNext = ( ( firstDayOfWeek || 0 ) - day ).mod( 7 ) || 7;
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
    getISOWeekNumber: function getISOWeekNumber ( firstDayOfWeek, utc ) {
        // The week number of the year (Monday as the first day of
        // the week) as a decimal number [01,53]. If the week containing
        // 1 January has four or more days in the new year, then it is
        // considered week 1. Otherwise, it is the last week of the
        // previous year, and the next week is week 1.
        if ( firstDayOfWeek == null ) {
            firstDayOfWeek = 1;
        }

        // 4th January is always in week 1.
        var jan4 = utc ?
                new Date( Date.UTC( this.getUTCFullYear(), 0, 4 ) ) :
                new Date( this.getFullYear(), 0, 4 );
        var jan4WeekDay = utc ? jan4.getUTCDay() : jan4.getDay();
        // Find Monday before 4th Jan
        var wk1Start = jan4 - ( jan4WeekDay - firstDayOfWeek )
                .mod( 7 ) * aDay;
        // Week No == How many weeks have past since then, + 1.
        var week = Math.floor( ( this - wk1Start ) / 604800000 ) + 1;
        if ( week === 53 ) {
            var date = utc ? this.getUTCDate() : this.getDate();
            var day = utc ? this.getUTCDay() : this.getDay();
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
    add: function add ( number, unit ) {
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
    subtract: function subtract ( number, unit ) {
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
        k - Hour of the day in 12h clock (0-23), padded with a space if single
            digit.
        l - Hour of the day in 12h clock (1-12), padded with a space if single
            digit.
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
        z - Timezone offset
        Z - Timezone name or abbreviation.
        % - A '%' character.

        Parameters:
            format - {String} The pattern to use as a template for the string.
            utc    - {Boolean} Use UTC time.

        Returns:
            {String} The formatted date string.
    */
    format: function format ( format$1, utc ) {
        var date = this;
        return format$1 ?
            format$1.replace(/%(-)?([%A-Za-z])/g,
                function ( string, nopad, character ) {
            var num, str, offset, sign, hoursOffset, minutesOffset;
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
                return LocaleController ?
                    LocaleController.date( date, 'fullDateAndTime' ) :
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
                return num ? pad( num < 13 ? num : num - 12, nopad ) : '12';
            case 'j':
                // Day of the year as a decimal number (001-366).
                num = date.getDayOfYear( utc );
                return nopad ?
                    num + '' :
                    num < 100 ? '0' + pad( num ) : pad( num );
            case 'k':
                // Hour of the day in 12h clock (0-23), padded with a space if
                // single digit.
                return pad(
                    utc ? date.getUTCHours() : date.getHours(), nopad, ' ' );
            case 'l':
                // Hour of the day in 12h clock (1-12), padded with a space if
                // single digit.
                num = utc ? date.getUTCHours() : date.getHours();
                return num ?
                    pad( num < 13 ? num : num - 12, nopad, ' ' ) :
                    '12';
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
                return LocaleController ?
                    LocaleController.get( str + 'Designator' ) : str.toUpperCase();
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
                return LocaleController ?
                    LocaleController.date( date, 'date' ) :
                    date.format( '%d/%m/%y', utc );
            case 'X':
                // The locale's appropriate time representation.
                return LocaleController ?
                    LocaleController.date( date, 'time' ) : date.format( '%H:%M', utc );
            case 'y':
                // Year without century (00-99).
                return ( utc ?
                    date.getUTCFullYear() : date.getFullYear()
                ).toString().slice( 2 );
            case 'Y':
                // Year with century (0-9999).
                return utc ? date.getUTCFullYear() : date.getFullYear();
            case 'z':
                // Timezone offset
                offset = date.getTimezoneOffset();
                sign = ( offset > 0 ? '-' : '+' );
                offset = Math.abs( offset );
                hoursOffset = ~~( offset / 60 );
                minutesOffset = offset - ( 60 * hoursOffset );
                return sign +
                    '%\'02n'.format( hoursOffset ) +
                    ':%\'02n'.format( minutesOffset );
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
    },
});

// TODO(cmorgan/modulify): do something about these exports: Date#fromJSON,
// Date#getDaysInMonth, Date#getDaysInYear, Date#isLeapYear, Date#isToday,
// Date#isOnSameDayAs, Date#getDayName, Date#getMonthName, Date#getDayOfYear,
// Date#getWeekNumber, Date#getISOWeekNumber, Date#add, Date#subtract,
// Date#format

var compileTranslation = function ( translation ) {
    var compiled = '';
    var start = 0;
    var searchIndex = 0;
    var length = translation.length;

    outer: while ( true ) {
        var end = translation.indexOf( '[', searchIndex );
        // If there are no more macros, just the last text section to
        // process.
        if ( end === -1 ) {
            end = length;
        } else {
            // Check the '[' isn't escaped (preceded by an odd number of
            // '~' characters):
            var j = end;
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
        var part = translation.slice( start, end ).replace( /~(.)/g, '$1' );
        if ( part ) {
            if ( compiled ) {
                compiled += '+';
            }
            compiled += JSON.stringify( part );
        }
        // Check if we've reached the end of the string
        if ( end === length ) {
            break;
        }
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
            var j$1 = end;
            while ( j$1-- ) {
                if ( translation[ j$1 ] !== '~' ) {
                    break;
                }
            }
            if ( ( end - j$1 ) % 2 ) {
                break;
            }
            searchIndex = end + 1;
        }
        // Split into parts
        var parts = translation.slice( start, end ).split( ',' );
        var l = parts.length;

        if ( compiled ) {
            compiled += '+';
        }
        if ( l > 1 ) {
            compiled += 'lang.macros["';
        }
        for ( var i = 0; i < l; i += 1 ) {
            // If not the first part, add a comma to separate the
            // arguments to the macro function call.
            if ( i > 1 ) {
                compiled += ',';
            }
            // If a comma was escaped, we split up an argument.
            // Rejoin these.
            var part$1 = parts[i];
            var partLength = part$1.length;
            while ( partLength && part$1[ partLength - 1 ] === '~' ) {
                i += 1;
                part$1 += ',';
                part$1 += parts[i];
                partLength = part$1.length;
            }
            // Unescape the part.
            part$1 = part$1.replace( /~(.)/g, '$1' );
            // Check if we've got an argument.
            if ( /^_(?:\*|\d+)$/.test( part$1 ) ) {
                part$1 = part$1.slice( 1 );
                compiled += 'args';
                compiled += ( part$1 === '*' ?
                    '' : '[' + ( parseInt( part$1, 10 ) - 1 ) + ']'
                );
            } else { // Otherwise:
                if ( !i ) {
                    // First part is the macro name.
                    compiled += ( part$1 === '*' ?
                        'quant' : part$1 === '#' ? 'numf' : part$1 );
                    compiled += '"].call(lang,';
                } else {
                    // Anything else is a plain string argument
                    compiled += JSON.stringify( part$1 );
                }
            }
        }
        if ( l > 1 ) {
            compiled += ')';
        }
        start = searchIndex = end + 1;
    }

    return new Function( 'lang', 'args',
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
var Locale = Class({

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
    init: function init ( mixin$$1 ) {
        var this$1 = this;

        [ 'macros', 'dateFormats' ].forEach( function (obj) {
            this$1[ obj ] = Object.create( this$1[ obj ] );
        });
        this.compiled = {};
        merge( this, mixin$$1 );
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
    getFormattedNumber: function getFormattedNumber ( number ) {
        var integer = number + '';
        var fraction = '';
        var decimalPointIndex = integer.indexOf( '.' );
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
    getFormattedOrdinal: function getFormattedOrdinal ( number ) {
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
    getFormattedFileSize: function getFormattedFileSize ( bytes, decimalPlaces ) {
        var units = this.fileSizeUnits;
        var l = units.length - 1;
        var i = 0;
        var ORDER_MAGNITUDE = 1000;
        while ( i < l && bytes >= ORDER_MAGNITUDE ) {
            bytes /= ORDER_MAGNITUDE;
            i += 1;
        }
        // B/KB to nearest whole number, MB/GB to 1 decimal place.
        var number = ( i < 2 ) ?
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
        time: function time ( date, locale, utc ) {
            return date.format(
                locale.use24hClock ? this.time24 : this.time12, utc );
        },
        time12: '%-I:%M %p',
        time24: '%H:%M',
        fullDate: '%A, %-d %B %Y',
        fullDateAndTime: '%A, %-d %B %Y %H:%M',
        abbreviatedFullDate: '%a, %-d %b %Y',
        shortDayMonth: '%-d %b',
        shortDayMonthYear: '%-d %b ’%y',
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
    getFormattedDate: function getFormattedDate ( date, type, utc ) {
        var dateFormats = this.dateFormats;
        var format = dateFormats[ type ] || dateFormats.date;
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
        '*1': function _1 ( n, singular, zero ) {
            return ( !n && zero !== undefined ? zero : singular
            ).replace( '%n', formatInt( n, this ) );
        },
        // Most Western languages.
        // Case 1: is 1.
        // Case 2: everything else.
        // Case 3: is 0 (optional; plural used if not supplied).
        '*2': function _2 ( n, singular, plural, zero ) {
            return ( n === 1 ? singular :
                !n && zero !== undefined ? zero : plural
            ).replace( '%n', formatInt( n, this ) );
        },
        // French and Brazilian Portuguese.
        // Case 1: is 0 or 1.
        // Case 2: everything else.
        // Case 3: is 0 (optional; singular used if not supplied).
        '*2a': function _2a ( n, singular, plural, zero ) {
            return ( n > 1 ? plural :
                !n && zero !== undefined ? zero : singular
            ).replace( '%n', formatInt( n, this ) );
        },
        // Hungarian
        // Case 1: is 0,*3,*6,*8,*20,*30,*60,*80,*00,*000000, *000000+.
        // Case 2: everything else
        //        (*1,*2,*4,*5,*7,*9,*10,*40,*50,*70,*90,*000,*0000,*00000).
        // Case 3: is 0 (optional; case 1 used if not supplied)
        '*2b': function _2b ( n, form1, form2, zero ) {
            return ( !n ? zero !== undefined ? zero : form1 :
                ( /(?:[368]|20|30|60|80|[^0]00|0{6,})$/.test( n + '' ) ) ?
                form1 : form2
            ).replace( '%n', formatInt( n, this ) );
        },
        // Latvian.
        // Case 1: is 0.
        // Case 2: ends in 1, does not end in 11.
        // Case 3: everything else.
        '*3a': function _3a ( n, zero, plural1, plural2 ) {
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
        '*3b': function _3b ( n, singular, plural1, plural2, zero ) {
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
        '*3c': function _3c ( n, form1, form2, form3, zero ) {
            var mod10 = n % 10;
            var mod100 = n % 100;
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
        '*3d': function _3d ( n, form1, form2, form3, zero ) {
            var mod10 = n % 10;
            var mod100 = n % 100;
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
        '*3e': function _3e ( n, singular, plural1, plural2, zero ) {
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
        '*3f': function _3f ( n, singular, plural1, plural2, zero ) {
            var mod10 = n % 10;
            var mod100 = n % 100;
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
        '*4a': function _4a ( n, end01, end02, end03or04, plural, zero ) {
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
        '*4b': function _4b ( n, form1, form2, form3, form4, zero ) {
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
        '*5': function _5 ( n, singular, doubular, form1, form2, form3, zero ) {
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
        '*6': function _6 ( n, zero, singular, doubular, pl1, pl2, pl3 ) {
            var mod100 = n % 100;
            return (
                !n ? zero :
                n === 1 ? singular :
                n === 2 ? doubular :
                3 <= mod100 && mod100 <= 10 ? pl1 :
                11 <= mod100 && mod100 <= 99 ? pl2 : pl3
            ).replace( '%n', formatInt( n, this ) );
        },
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

               O.loc(
                 "[*2,_1,1 file was,%n files were,No files were] found in [_2]",
                 11, "Documents" );
               => "11 files were found in Documents"

        2. If at least one of the arguments is an object:

           The result will be an array of string parts and your arguments.
           This can be useful when working with views, for example:

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
    translate: function translate ( string ) {
        var arguments$1 = arguments;
        var this$1 = this;

        var translation = this.translations[ string ];
        var returnString = true;
        var args = [];
        var i, l;

        if ( translation === undefined ) {
            translation = string;
        }

        for ( i = 1, l = arguments.length; i < l; i += 1 ) {
            var arg = arguments$1[i];
            if ( typeof arg === 'object' ) {
                returnString = false;
            }
            args[ i - 1 ] = arg;
        }

        if ( returnString ) {
            var compiled = this.compiled[ string ] ||
                ( this.compiled[ string ] = compileTranslation( translation ) );
            return compiled( this, args );
        }

        var parts = translation.split( /\[_(\d)\]/ );
        for ( i = 0, l = parts.length; i < l; i += 1 ) {
            var part = parts[i];
            if ( i % 2 === 1 ) {
                parts[i] = args[ part - 1 ] || null;
            } else if ( part.indexOf( '[*' ) !== -1 ) {
                // Presumably it contains a macro; execute that.
                var compiled$1 = this$1.compiled[ part ] ||
                    ( this$1.compiled[ part ] = compileTranslation( part ) );
                parts[i] = compiled$1( this$1, args );
            }
        }
        return parts;
    },
});

/*global Intl */

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
    xx: new Locale({ code: 'xx' }),
};

/* eslint-disable max-len */
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
    'Z': '[Zz\u0179-\u017e\u01f1-\u01f3\u1dbb\u1e90-\u1e95\u2124\u2128\u24b5\u24cf\u24e9\u3390-\u3394\uff3a\uff5a]',
};
/* eslint-enable max-len */

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
    addLocale: function addLocale ( locale ) {
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
    setLocale: function setLocale ( localeCode ) {
        if ( locales[ localeCode ] ) {
            active = locales[ localeCode ];
            this.activeLocaleCode = localeCode;
            if ( typeof Intl !== 'undefined' ) {
                this.compare = new Intl.Collator( localeCode, {
                    sensitivity: 'base',
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
    getLocale: function getLocale ( localeCode ) {
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
    get: function get ( key ) {
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
    localise: function localise ( text ) {
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
    date: function date ( date$1, type, utc ) {
        return active.getFormattedDate( date$1, type, utc );
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
    number: function number ( n ) {
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
    ordinal: function ordinal ( n ) {
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
    fileSize: function fileSize ( bytes, decimalPlaces ) {
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
    compare: function compare ( a, b ) {
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
    makeSearchRegExp: function makeSearchRegExp ( string ) {
        return new RegExp(
            '(?:^|\\W|_)' +
            string.escapeRegExp().replace( /[A-Z]/gi,
                function (letter) { return alternatives[ letter.toUpperCase() ]; } ),
            'i'
        );
    },

    /**
        Property: O.LocaleController.letterAlternatives
        Type: String[String]

        Maps upper-case A-Z to a character class string containing all unicode
        alternatives that resemble that letter.
    */
    letterAlternatives: alternatives,
};

var loc = LocaleController.localise;

// Yeah, core is importing something from localisation. Boundaries like “core”
// and “localisation” aren’t solid boundaries these days, anyway. Deal with it.
// It’s not a circular import. Everyone’s happy.
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
function sortByProperties ( properties ) {
    if ( !( properties instanceof Array ) ) {
        properties = [ properties ];
    }
    var l = properties.length;

    return function ( a, b ) {
        var hasGet = !!a.get;
        for ( var i = 0; i < l; i += 1 ) {
            var prop = properties[i];
            var aVal = hasGet ? a.get( prop ) : a[ prop ];
            var bVal = hasGet ? b.get( prop ) : b[ prop ];
            var type = typeof aVal;

            // Must be the same type
            if ( type === typeof bVal ) {
                if ( type === 'boolean' && aVal !== bVal ) {
                    return aVal ? -1 : 1;
                }
                if ( type === 'string' ) {
                    if ( isNumber.test( aVal ) && isNumber.test( bVal ) ) {
                        aVal = +aVal;
                        bVal = +bVal;
                    } else {
                        return LocaleController.compare( aVal, bVal );
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
}

Object.assign( Array.prototype, {
    /**
        Method: Array#get

        Returns the property of the object with the name given as the only
        parameter.

        Parameters:
            key - {String} The name of the property to return.

        Returns:
            {*} The requested property of this array.
    */
    get: function get ( key ) {
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
    set: function set ( key, value ) {
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
    getObjectAt: function getObjectAt ( index ) {
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
    setObjectAt: function setObjectAt ( index, value ) {
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
    include: function include ( item ) {
        var i = 0;
        var l = this.length;
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
    erase: function erase ( item ) {
        var this$1 = this;

        var l = this.length;
        while ( l-- ) {
            if ( this$1[l] === item ) {
                this$1.splice( l, 1 );
            }
        }
        return this;
    },
});

// TODO(cmorgan/modulify): do something about these exports: Array#get,
// Array#set, Array#getObjectAt, Array#setObjectAt, Array#include, Array#erase

Object.assign( Object, {
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
    keyOf: function keyOf ( object, value ) {
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
    filter: function filter ( object, include ) {
        var result = {};
        for ( var key in object ) {
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
    zip: function zip ( keys, values ) {
        var l = Math.min( keys.length, values.length );
        var obj = {};
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
    fromQueryString: function fromQueryString ( query ) {
        var result = {};
        query.split( '&' ).forEach( function ( pair ) {
            var parts = pair.split( '=' ).map( decodeURIComponent );
            result[ parts[0] ] = parts[1];
        });
        return result;
    },
});

// TODO(cmorgan/modulify): do something about these exports:
// Object.keyOf, Object.filter, Object.zip, Object.fromQueryString

/**
    Property: RegExp.email
    Type: RegExp

    A regular expression for detecting an email address.
*/
RegExp.email = /\b([\w.%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;

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
//     [a-z0-9.-]+[.][a-z]{2,}\/   # or url like thing followed by a slash
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

// eslint-disable-next-line max-len
RegExp.url = /\b(?:https?:\/\/|www\d{0,3}[.]|[a-z0-9.-]+[.][a-z]{2,}\/)(?:[^\s()<>]+|\([^\s()<>]+\))+(?:\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))*\)|[^\s`!()[\]{};:'".,<>?«»“”‘’])/i;

// TODO(cmorgan/modulify): do something about these exports: RegExp.email,
// RegExp.url

/**
    Function: O.getFromPath

    Follows a path string (e.g. 'mailbox.messages.howMany') to retrieve the
    final object/value from a root object. At each stage of the path, if the
    current object supports a 'get' function, that will be used to retrieve the
    next stage, otherwise it will just be read directly as a property.

    If the full path cannot be followed, `undefined` will be returned.

    Parameters:
        root - {Object} The root object the path is relative to.
        path - {String} The path to retrieve the value from.

    Returns:
        {*} Returns the value at the end of the path.
*/
var isNum$1 = /^\d+$/;
function getFromPath ( root, path ) {
    var currentPosition = 0;
    var pathLength = path.length;
    while ( currentPosition < pathLength ) {
        if ( !root ) {
            return undefined;
        }
        var nextDot = path.indexOf( '.', currentPosition );
        if ( nextDot === -1 ) {
            nextDot = pathLength;
        }
        var key = path.slice( currentPosition, nextDot );
        root = root.getObjectAt && isNum$1.test( key ) ?
            root.getObjectAt( +key ) :
            root.get ?
                root.get( key ) :
                root[ key ];
        currentPosition = nextDot + 1;
    }
    return root;
}

var Heap = Class({

    init: function init ( comparator ) {
        this.data = [];
        this.length = 0;
        this.comparator = comparator;
    },

    _up: function _up ( i ) {
        var data = this.data;
        var comparator = this.comparator;
        var parentNode;

        var node = data[i];
        while ( i ) {
            // Get parent node
            var j = ( i - 1 ) >> 1;
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

    _down: function _down ( i ) {
        var data = this.data;
        var length = this.length;
        var comparator = this.comparator;

        var node = data[i];
        while ( true ) {
            var j = ( i << 1 ) + 1;
            var k = j + 1;

            // Does it have children?
            if ( j >= length ) {
                break;
            }
            var childNode = data[j];

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

    push: function push ( node ) {
        if ( node != null ) {
            var length = this.length;
            this.data[ length ] = node;
            this.length = length + 1;
            this._up( length );
        }
        return this;
    },

    pop: function pop () {
        var data = this.data;
        var length = this.length;

        if ( !length ) {
            return null;
        }

        var nodeToReturn = data[0];

        length -= 1;
        data[0] = data[ length ];
        data[ length ] = null;
        this.length = length;

        this._down( 0 );

        return nodeToReturn;
    },

    peek: function peek () {
        return this.data[0];
    },

    remove: function remove ( node ) {
        var data = this.data;
        var length = this.length;
        var i = node == null || !length ?
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
    },
});

/*global setTimeout, clearTimeout, console */

var win = window;

var setImmediate = window.setImmediate || function ( fn ) {
        return setTimeout( fn, 0 );
    };

var requestAnimFrame =
    win.requestAnimationFrame       ||
    win.oRequestAnimationFrame      ||
    win.webkitRequestAnimationFrame ||
    win.mozRequestAnimationFrame    ||
    win.msRequestAnimationFrame     ||
    ( function () {
        var lastTime = 0;
        return function ( callback ) {
            var time = Date.now();
            var timeToNextCall = Math.max( 0, 16 - ( time - lastTime ) );
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

var parentsBeforeChildren = function ( a, b ) {
    var aView = a[1];
    var bView = b[1];

    // Cheap test for ( x instanceof View )
    if ( !aView || !aView.parentView ) {
        aView = null;
    }
    if ( !bView || !bView.parentView ) {
        bView = null;
    }

    // If equal, order doesn't matter
    if ( aView === bView ) {
        return 0;
    }

    // Redraw views before bindings directly to DOM nodes; it may remove
    // the view from the DOM so the update is cheaper
    if ( !aView || !bView ) {
        return !aView ? 1 : -1;
    }

    // Redraw parents before children; it may remove the child so nullify
    // the need to redraw.
    var aDepth = 0;
    var bDepth = 0;
    while (( aView = aView.get( 'parentView' ) )) {
        aDepth += 1;
    }
    while (( bView = bView.get( 'parentView' ) )) {
        bDepth += 1;
    }
    return aDepth - bDepth;
};

/**
    Class: O.RunLoop

    The run loop allows data to propagate through the app in stages, preventing
    multiple changes to an object firing off the same observers several times.
    To use, wrap the entry point functions in a call to <O.RunLoop.invoke>.
*/

// eslint-disable-next-line prefer-const
var nextLoop;
var processTimeouts;
var nextFrame;
// (Because of a false positive. TODO(cmorgan): report this as a bug in eslint.)

var RunLoop = {

    mayRedraw: false,

    /**
        Property (private): O.RunLoop._queueOrder
        Type: String[]

        The order in which to flush the queues.
    */
    _queueOrder: [ 'before', 'bindings', 'middle', 'render', 'after' ],

    /**
        Property (private): O.RunLoop._queues
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
        nextFrame: [],
    },

    /**
        Property (private): O.RunLoop._timeouts
        Type: O.Heap

        A priority queue of timeouts.
    */
    _timeouts: new Heap( function ( a, b ) {
        return a.time - b.time;
    }),

    /**
        Property (private): O.RunLoop._nextTimeout
        Type: Number

        Epoch time that the next browser timeout is scheduled for.
    */
    _nextTimeout: 0,

    /**
        Property (private): O.RunLoop._timer
        Type: Number

        The browser timer id (response from setTimeout), which you need if
        you want to cancel the timeout.
    */
    _timer: null,

    /**
        Property (private): O.RunLoop._depth
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
    flushQueue: function flushQueue ( queue ) {
        var toInvoke = this._queues[ queue ];
        var l = toInvoke.length;

        if ( l ) {
            this._queues[ queue ] = [];

            if ( queue === 'render' ) {
                toInvoke.sort( parentsBeforeChildren );
            }

            for ( var i = 0; i < l; i += 1 ) {
                var tuple = toInvoke[i];
                var fn = tuple[0];
                var bind = tuple[1];
                try {
                    if ( bind ) {
                        fn.call( bind );
                    } else {
                        fn();
                    }
                } catch ( error ) {
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
    flushAllQueues: function flushAllQueues () {
        var this$1 = this;

        var order = this._queueOrder;
        var l = order.length;
        var i = 0;
        while ( i < l ) {
            // "Render" waits for next frame, except if in bg, since
            // animation frames don't fire while in the background and we want
            // to flush queues in a reasonable time, as they may redraw the tab
            // name, favicon etc.
            if ( !document.hidden && (
                    ( i === 3 && !this$1.mayRedraw ) ) ) {
                if ( !this$1._queues.nextFrame.length ) {
                    requestAnimFrame( nextFrame );
                }
                return;
            }
            if ( this$1.flushQueue( order[i] ) ) {
                i = 0;
            } else {
                i = i + 1;
            }
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
    queueFn: function queueFn ( queue, fn, bind, allowDups ) {
        var this$1 = this;

        var toInvoke = this._queues[ queue ];
        var l = toInvoke.length;
        // Log error here, as the stack trace is useless inside flushQueue.
        if ( !fn ) {
            try {
                fn();
            } catch ( error ) {
                RunLoop.didError( error );
            }
        } else {
            if ( !allowDups ) {
                for ( var i = 0; i < l; i += 1 ) {
                    var tuple = toInvoke[i];
                    if ( tuple[0] === fn && tuple[1] === bind ) {
                        return this$1;
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
            {*} The return value of the invoked function, or `undefined` if it
                throws an exception.
    */
    invoke: function invoke ( fn, bind, args ) {
        var returnValue;
        this._depth += 1;
        try {
            // Avoiding apply/call when not needed is faster
            if ( args ) {
                returnValue = fn.apply( bind, args );
            } else if ( bind ) {
                returnValue = fn.call( bind );
            } else {
                returnValue = fn();
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
        return returnValue;
    },

    /**
        Method: O.RunLoop.invokeInNextEventLoop

        Use this to invoke a function in a new browser event loop, immediately
        after this event loop has finished.

        Parameters:
            fn   - {Function} The function to invoke.
            bind - {Object} (optional) The object to make the 'this' parameter
                   when the function is invoked.
            allowDups - {Boolean} (optional) If not true, will search queue to
                        check this fn/bind combination is not already present.

        Returns:
            {O.RunLoop} Returns self.
    */
    invokeInNextEventLoop: function invokeInNextEventLoop ( fn, bind, allowDups ) {
        if ( !this._queues.nextLoop.length ) {
            setImmediate( nextLoop );
        }
        return this.queueFn( 'nextLoop', fn, bind, allowDups );
    },

    /**
        Method: O.RunLoop.invokeInNextFrame

        Use this to invoke a function just before the browser next redraws.

        Parameters:
            fn   - {Function} The function to invoke.
            bind - {Object} (optional) The object to make the 'this' parameter
                   when the function is invoked.
            allowDups - {Boolean} (optional) If not true, will search queue to
                        check this fn/bind combination is not already present.

        Returns:
            {O.RunLoop} Returns self.
    */
    invokeInNextFrame: function invokeInNextFrame ( fn, bind, allowDups ) {
        if ( !this._queues.nextFrame.length ) {
            requestAnimFrame( nextFrame );
        }
        return this.queueFn( 'nextFrame', fn, bind, allowDups );
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
    invokeAfterDelay: function invokeAfterDelay ( fn, delay, bind ) {
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
    invokePeriodically: function invokePeriodically ( fn, period, bind ) {
        var timeout = new Timeout( Date.now() + period, period, fn, bind );
        this._timeouts.push( timeout );
        this._scheduleTimeout();
        return timeout;
    },

    /**
        Method (private): O.RunLoop._scheduleTimeout

        Sets the browser timer if necessary to trigger at the time of the next
        timeout in the priority queue.
    */
    _scheduleTimeout: function _scheduleTimeout () {
        var timeout = this._timeouts.peek();
        var time = timeout ? timeout.time : 0;
        if ( time && time !== this._nextTimeout ) {
            clearTimeout( this._timer );
            var delay = time - Date.now();
            if ( delay > 0 ) {
                this._timer = setTimeout( processTimeouts, time - Date.now() );
                this._nextTimeout = time;
            } else {
                this._nextTimeout = 0;
            }
        }
    },

    /**
        Method: O.RunLoop.processTimeouts

        Invokes all functions in the timeout queue that were scheduled to
        trigger on or before "now".

        Returns:
            {O.RunLoop} Returns self.
    */
    processTimeouts: function processTimeouts () {
        var this$1 = this;

        var timeouts = this._timeouts;
        while ( timeouts.length && timeouts.peek().time <= Date.now() ) {
            var timeout = timeouts.pop();
            var period = (void 0);
            if ( period = timeout.period ) {
                timeout.time = Date.now() + period;
                timeouts.push( timeout );
            }
            this$1.invoke( timeout.fn, timeout.bind );
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
    cancel: function cancel ( token ) {
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
    didError: function didError ( error ) {
        if ( window.console ) {
            console.log( error.name, error.message, error.stack );
        }
    },
};

Object.assign( Function.prototype, {
    /**
        Method: Function#queue

        Parameters:
            queue - {String} The name of the queue to add calls to this function
                    to.

        Returns:
            {Function} Returns wrapper that passes calls to
            <O.RunLoop.queueFn>.
    */
    queue: function queue ( queue$1 ) {
        var fn = this;
        return function () {
            RunLoop.queueFn( queue$1, fn, this );
            return this;
        };
    },

    /**
        Method: Function#nextLoop

        Returns:
            {Function} Returns wrapper that passes calls to
            <O.RunLoop.invokeInNextEventLoop>.
    */
    nextLoop: function nextLoop () {
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
    nextFrame: function nextFrame () {
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
    invokeInRunLoop: function invokeInRunLoop () {
        var fn = this;
        return function () {
            return RunLoop.invoke( fn, this, arguments );
        };
    },
});

nextLoop = RunLoop.invoke.bind( RunLoop,
    RunLoop.flushQueue, RunLoop, [ 'nextLoop' ]
);
processTimeouts = RunLoop.processTimeouts.bind( RunLoop );

nextFrame = function ( time ) {
    RunLoop.frameStartTime = time;
    RunLoop.mayRedraw = true;
    RunLoop.invoke( RunLoop.flushQueue, RunLoop, [ 'nextFrame' ] );
    RunLoop.mayRedraw = false;
};

// TODO(cmorgan/modulify): do something about these exports: Function#queue,
// Function#nextLoop, Function#nextFrame, Function#invokeInRunLoop

/*global Element */

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
    The section before the `*` is taken to be static. If no `*` is present, the
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
    var beginObservablePath = path.lastIndexOf( '*' ) + 1;
    var observablePath = path.slice( beginObservablePath );
    var staticPath = beginObservablePath ?
            path.slice( 0, beginObservablePath - 1 ) : '';
    var lastDot = observablePath.lastIndexOf( '.' );

    binding[ direction + 'Object' ] =
        staticPath ? getFromPath( root, staticPath ) : root;
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
var identity = function (v) { return v; };

var Binding = Class({

    __setupProperty__: function __setupProperty__ ( metadata, key ) {
        metadata.bindings[ key ] = this;
        metadata.inits.Bindings = ( metadata.inits.Bindings || 0 ) + 1;
    },
    __teardownProperty__: function __teardownProperty__ ( metadata, key ) {
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
    init: function init ( mixin$$1 ) {
        var this$1 = this;

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

        for ( var key in mixin$$1 ) {
            this$1[ key ] = mixin$$1[ key ];
        }
    },

    /**
        Method: O.Binding#destroy

        Disconnects binding and prevents any further value syncs.
    */
    destroy: function destroy () {
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
    from: function from ( root, path ) {
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
    to: function to ( root, path ) {
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
    connect: function connect () {
        if ( this.isConnected ) {
            return this;
        }

        this.isSuspended = false;

        // Resolve objects:
        _resolveRootAndPath(
            this, 'from', this._fromRoot || this._toRoot, this._fromPath );
        _resolveRootAndPath(
            this, 'to', this._toRoot || this._fromRoot, this._toPath );

        var fromObject = this.fromObject;
        var toObject = this.toObject;

        if ( toObject instanceof Element ) {
            this.queue = 'render';
        }

        // Occassionally we have a binding created before the objects it
        // connects are, in which case delay connecting it a bit.
        if ( !this._doNotDelayConnection && ( !fromObject || !toObject ) ) {
            this._doNotDelayConnection = true;
            RunLoop.queueFn( 'before', this.connect, this );
            return this;
        }

        // This is a debugging aid; TypeErrors with messages like “x is null” or
        // “cannot read property 'addObserverForPath' of undefined” aren’t very
        // useful. The source line where the binding was defined is lost in the
        // mists of time (in debug mode I guess we *could* store a stack trace
        // in the constructor, but that’s a desperate measure), but the fromPath
        // is commonly useful in determining what went wrong.
        var fromPath = this.fromPath;
        if ( !fromObject ) {
            throw new TypeError( 'Binding#connect: fromObject is not set' +
                ' (fromPath = ' + fromPath + ')'
            );
        }
        fromObject.addObserverForPath( fromPath, this, 'fromDidChange' );

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
    disconnect: function disconnect () {
        if ( !this.isConnected ) {
            return this;
        }

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
    suspend: function suspend () {
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
    resume: function resume () {
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
    fromDidChange: function fromDidChange () {
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
    toDidChange: function toDidChange () {
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
    needsSync: function needsSync ( direction ) {
        var queue = this.queue;
        var inQueue = this.isNotInSync;
        this.willSyncForward = direction;
        this.isNotInSync = true;
        if ( !inQueue && !this.isSuspended ) {
            if ( queue ) {
                RunLoop.queueFn( queue, this.sync, this, true );
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
    sync: function sync ( force ) {
        if ( !force && ( !this.isNotInSync || this.isSuspended ) ) {
            return false;
        }

        this.isNotInSync = false;

        var syncForward = this.willSyncForward;
        var from = syncForward ? 'from' : 'to';
        var to = syncForward ? 'to' : 'from';
        var pathBeforeKey = this[ to + 'PathBeforeKey' ];
        var toObject = this[ to + 'Object' ];

        if ( pathBeforeKey ) {
            toObject = toObject.getFromPath( pathBeforeKey );
        }
        if ( !toObject ) {
            return false;
        }

        var key = this[ to + 'Key' ];
        var value = this.transform(
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
    },
});

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
var bind = function ( root, path, transform ) {
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
var bindTwoWay = function ( root, path, transform ) {
    var binding = bind( root, path, transform );
    binding.isTwoWay = true;
    return binding;
};

var bindingKey = '__binding__';

/**
    Mixin: O.BoundProps

    The BoundProps mixin provides support for initialising bound properties
    inherited from the prototype, and for suspending/resuming bindings on the
    object.
*/
var BoundProps = {
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
    initBindings: function initBindings () {
        var this$1 = this;

        var bindings = meta( this ).bindings;
        for ( var key in bindings ) {
            // Guard in case a previously bound property has been overridden in
            // a subclass by a non-bound value.
            var binding = (void 0);
            if ( binding = bindings[ key ] ) {
                if ( !bindings.hasOwnProperty( key ) ) {
                    binding = bindings[ key ] = Object.create( binding );
                }
                // Set it to undefined. If the initial value to be synced
                // is undefined, nothing will be synced, but we don't want to
                // leave the Binding object itself as the value; instead we want
                // the value to be undefined.
                this$1[ key ] = undefined;
                binding.to( key, this$1 ).connect();
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
    destroyBindings: function destroyBindings () {
        var bindings = meta( this ).bindings;
        for ( var key in bindings ) {
            // Guard in case a previously bound property has been overridden in
            // a subclass by a non-bound value.
            var binding = bindings[ key ];
            if ( binding ) {
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
    registerBinding: function registerBinding ( binding ) {
        var metadata = meta( this );
        metadata.bindings[ bindingKey + guid( binding ) ] = binding;
        metadata.inits.Bindings = ( metadata.inits.Bindings || 0 ) + 1;
        return this;
    },

    /**
        Method: O.BoundProps#deregisterBinding

        Call this if you destroy a binding to this object before the object
        itself is destroyed.

        Returns:
            {O.BoundProps} Returns self.
    */
    deregisterBinding: function deregisterBinding ( binding ) {
        var metadata = meta( this );
        var bindings = metadata.bindings;
        var key = Object.keyOf( bindings, binding );
        if ( key ) {
            bindings[ key ] = null;
            metadata.inits.Bindings -= 1;
        }
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
    suspendBindings: function suspendBindings () {
        var bindings = meta( this ).bindings;
        for ( var key in bindings ) {
            var binding = bindings[ key ];
            if ( binding ) {
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
    resumeBindings: function resumeBindings () {
        var bindings = meta( this ).bindings;
        for ( var key in bindings ) {
            var binding = bindings[ key ];
            if ( binding ) {
                binding.resume();
            }
        }
        return this;
    },
};

/**
    Module: Foundation

    The Foundation module provides the basic objects and mixins for key-value
    coding and observation as well as bindings and a run loop.
*/

var slice = Array.prototype.slice;

var makeComputedDidChange = function ( key ) {
    return function () {
        this.computedPropertyDidChange( key );
    };
};

var setupComputed = function ( metadata, key, obj ) {
    var dependencies = this.dependencies;
    var dependents = metadata.dependents;
    var method, pathObservers, methodObservers;

    if ( !metadata.hasOwnProperty( 'dependents' ) ) {
        dependents = metadata.dependents = clone( dependents );
        metadata.allDependents = {};
    }
    var l = dependencies.length;
    while ( l-- ) {
        var valueThisKeyDependsOn = dependencies[l];
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
    var dependencies = this.dependencies;
    var dependents = metadata.dependents;
    var method, pathObservers, methodObservers;

    if ( !metadata.hasOwnProperty( 'dependents' ) ) {
        dependents = metadata.dependents = clone( dependents );
        metadata.allDependents = {};
    }
    var l = dependencies.length;
    while ( l-- ) {
        var valueThisKeyDependsOn = dependencies[l];
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

Object.assign( Function.prototype, {
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
    property: function property () {
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
    nocache: function nocache () {
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
    doNotNotify: function doNotNotify () {
        this.isSilent = true;
        return this;
    },
});

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

var ComputedProps = {
    /**
        Method: O.ComputedProps#propertiesDependentOnKey

        Returns an array of the name of all computed properties
        which depend on the given key.

        Parameters:
            key - {String} The name of the key to fetch the dependents of.

        Returns:
            {Array} Returns the list of dependents (may be empty).
    */
    propertiesDependentOnKey: function propertiesDependentOnKey ( key ) {
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
    propertyDidChange: function propertyDidChange ( key/*, oldValue, newValue*/ ) {
        var dependents = this.propertiesDependentOnKey( key );
        var l = dependents.length;
        var cache = meta( this ).cache;
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
            newValue - {*} (optional) The new value for the property

        Returns:
            {O.ComputedProps} Returns self.
    */
    computedPropertyDidChange: function computedPropertyDidChange ( key, newValue ) {
        var cache = meta( this ).cache;
        var oldValue = cache[ key ];
        delete cache[ key ];
        if ( newValue !== undefined ) {
            cache[ key ] = newValue;
        }
        return this.propertyDidChange( key, oldValue, newValue );
    },

    /**
        Method: O.ComputedProps#clearPropertyCache

        Deletes the cache of computed property values.

        Parameters:
            key - {String} The name of the property to fetch.

        Returns:
            {O.ComputedProps} Returns self.
    */
    clearPropertyCache: function clearPropertyCache () {
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
    set: function set ( key, value ) {
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
        } else {
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
    get: function get ( key ) {
        var value = this[ key ];
        if ( value && value.isProperty ) {
            if ( value.isVolatile ) {
                return value.call( this, undefined, key );
            }
            var cache = meta( this ).cache;
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
    getFromPath: function getFromPath$1 ( path ) {
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
    increment: function increment ( key, delta ) {
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
    toggle: function toggle ( key ) {
        return this.set( key, !this.get( key ) );
    },
};

// TODO(cmorgan/modulify): do something about these exports: Function#property,
// Function#nocache, Function#doNotNotify

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
    first: function first () {
        return this.getObjectAt( 0 );
    },

    /**
        Method: O.Enumerable#last

        Returns:
            {*} The last item in the enumerable.
    */
    last: function last () {
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
    indexOf: function indexOf ( item, from ) {
        var this$1 = this;

        var l = this.get( 'length' );
        for ( from = ( from < 0 ) ?
                Math.max( 0, l + from ) : ( from || 0 ); from < l; from += 1 ){
            if ( this$1.getObjectAt( from ) === item ) {
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
    lastIndexOf: function lastIndexOf ( item, from ) {
        var this$1 = this;

        var l = this.get( 'length' );
        for ( from = ( from < 0 ) ? ( l + from ) : ( from || l - 1 );
                from >= 0; from -= 1 ){
            if ( this$1.getObjectAt( from ) === item ) {
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
    binarySearch: function binarySearch ( value, comparator ) {
        var this$1 = this;

        var lower = 0,
            upper = this.get( 'length' ),
            middle, candidate;
        if ( !comparator ) {
            comparator = defaultComparator;
        }
        while ( lower < upper ) {
            middle = ( lower + upper ) >> 1;
            candidate = this$1.getObjectAt( middle );
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
    contains: function contains ( item ) {
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
    find: function find ( fn, bind ) {
        var this$1 = this;

        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            var value = this$1.getObjectAt( i );
            if ( callback( value, i, this$1 ) ) {
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
    forEach: function forEach ( fn, bind ) {
        var this$1 = this;

        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            callback( this$1.getObjectAt( i ), i, this$1 );
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
    filter: function filter ( fn, bind ) {
        var this$1 = this;

        var callback = createCallback( fn, bind );
        var results = [];
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            var value = this$1.getObjectAt( i );
            if ( callback( value, i, this$1 ) ) {
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
    map: function map ( fn, bind ) {
        var this$1 = this;

        var callback = createCallback( fn, bind );
        var results = [];
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            results[i] = callback( this$1.getObjectAt( i ), i, this$1 );
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
    reduce: function reduce ( fn, initial ) {
        var this$1 = this;

        var i = 0;
        var l = this.get( 'length' );
        var acc;

        if ( !l && arguments.length === 1 ) {
            throw new TypeError(
                'reduce of empty enumerable with no initial value' );
        }

        if ( arguments.length >= 2 ) {
            acc = initial;
        } else {
            acc = this.getObjectAt( 0 );
            i = 1;
        }
        for ( ; i < l; i += 1 ) {
            acc = fn( acc, this$1.getObjectAt( i ), i, this$1 );
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
    every: function every ( fn, bind ) {
        var this$1 = this;

        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            if ( !callback( this$1.getObjectAt( i ), i, this$1 ) ) {
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
    some: function some ( fn, bind ) {
        var this$1 = this;

        var callback = createCallback( fn, bind );
        for ( var i = 0, l = this.get( 'length' ); i < l; i += 1 ) {
            if ( callback( this$1.getObjectAt( i ), i, this$1 ) ) {
                return true;
            }
        }
        return false;
    },
};

// Copy the Enumerable methods to `Array.prototype`. This should be only the
// following: first last, binarySearch and contains.
// TODO: replace `contains` completely with the standardised method `includes`.
for ( var key in Enumerable ) {
    if ( !Array.prototype.hasOwnProperty( key ) ) {
        Array.prototype[ key ] = Enumerable[ key ];
    }
}



// TODO(cmorgan/modulify): do something about these exports:
// Array implements Enumerable

/**
    Class: O.Event

    Represents a synthetic event.
*/
var Event = Class({

    /**
        Constructor: O.Event

        Parameters:
            type   - {String} The event type.
            target - {Object} The target on which the event is to fire.
            mixin  - {Object} (optional) Any further properties to add to the
                     event.
    */
    init: function init ( type, target, mixin$$1 ) {
        this.type = type;
        this.target = target;
        this.defaultPrevented = false;
        this.propagationStopped = false;
        Object.assign( this, mixin$$1 );
    },

    /**
        Method: O.Event#preventDefault

        Prevent the default action for this event (if any).

        Returns:
            {O.Event} Returns self.
    */
    preventDefault: function preventDefault () {
        this.defaultPrevented = true;
        return this;
    },

    /**
        Method: O.Event#stopPropagation

        Stop bubbling the event up to the next target.

        Returns:
            {O.Event} Returns self.
    */
    stopPropagation: function stopPropagation () {
        this.propagationStopped = true;
        return this;
    },
});

var slice$1 = Array.prototype.slice;
var eventPrefix = '__event__';

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
Function.prototype.on = function () {
    return this.observes.apply( this,
        slice$1.call( arguments ).map( function ( type ) {
            return eventPrefix + type;
        })
    );
};

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

var EventTarget = {

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
    on: function on ( type, obj, method ) {
        if ( !( obj instanceof Function ) ) {
            obj = { object: obj, method: method };
        }
        type = eventPrefix + type;

        var observers = meta( this ).observers;
        var handlers = observers[ type ];
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
    once: function once ( type, fn ) {
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

        Both parameters are optional, but at least one must be specified. If the
        `type` parameter is omitted, the `event` parameter must be an `Event` or
        `O.Event` instance, and its `type` property will be used.

        Parameters:
            type  - {String} (optional) The name of the event being fired.
            event - {Event|O.Event|Object} (optional) An event object or object
                    of values to be added to the event object.

        Returns:
            {O.EventTarget} Returns self.
    */
    fire: function fire ( type, event ) {
        var target = this;
        if ( typeof type !== 'string' && !event ) {
            event = type;
            type = event.type;
        }
        var typeKey = eventPrefix + type;

        if ( !event || !( event instanceof Event ) ) {
            if ( event && /Event\]$/.test( event.toString() ) ) {
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
            var handlers = meta( target ).observers[ typeKey ];
            var length = handlers ? handlers.length : 0;
            while ( length-- ) {
                try {
                    var handler = handlers[ length ];
                    if ( handler instanceof Function ) {
                        handler.call( target, event );
                    } else {
                        ( handler.object || target )[ handler.method ]( event );
                    }
                } catch ( error ) {
                    RunLoop.didError( error );
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
    off: function off ( type, obj, method ) {
        type = eventPrefix + type;

        var observers = meta( this ).observers;
        var handlers = observers[ type ];
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
    },
};

// TODO(cmorgan/modulify): do something about these exports: Function#on

var slice$2 = Array.prototype.slice;

/**
    Mixin: O.MutableEnumerable

    The MutableEnumerable mixin adds a number of mutation methods to any class
    with a 'replaceObjectsAt' method and a 'get' method that supports 'length'.
    The API mirrors that of the native Array type.
*/
var MutableEnumerable = {

    // :: Mutation methods =====================================================

    /**
        Method: O.MutableEnumerable#push

        ECMAScript Array#push.

        Parameters:
            var_args - {...*} The items to add to the end of the array.

        Returns:
            {Number} The new length of the array.
    */
    push: function push () {
        var newItems = slice$2.call( arguments );
        this.replaceObjectsAt( this.get( 'length' ), 0, newItems );
        return this.get( 'length' );
    },

    /**
        Method: O.MutableEnumerable#pop

        ECMAScript Array#pop.

        Returns:
            {*} The removed last value from the array.
    */
    pop: function pop () {
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
    unshift: function unshift () {
        var newItems = slice$2.call( arguments );
        this.replaceObjectsAt( 0, 0, newItems );
        return this.get( 'length' );
    },

    /**
        Method: O.MutableEnumerable#shift

        ECMAScript Array#shift.

        Returns:
            {*} The removed first value from the array.
    */
    shift: function shift () {
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
    splice: function splice ( index, numberRemoved ) {
        var newItems = slice$2.call( arguments, 2 );
        return this.replaceObjectsAt( index, numberRemoved, newItems );
    },
};

var setupObserver = function ( metadata, method ) {
    var observes = this.observedProperties;
    var observers = metadata.observers;
    var l = observes.length;
    var pathObservers;

    while ( l-- ) {
        var key = observes[l];
        if ( key.indexOf( '.' ) === -1 ) {
            var keyObservers = observers[ key ];
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
    var observes = this.observedProperties;
    var observers = metadata.observers;
    var l = observes.length;
    var pathObservers;

    while ( l-- ) {
        var key = observes[l];
        if ( key.indexOf( '.' ) === -1 ) {
            var keyObservers = observers[ key ];
            if ( !observers.hasOwnProperty( key ) ) {
                keyObservers = observers[ key ] = keyObservers.slice();
            }
            var j = keyObservers.length;
            while ( j-- ) {
                var observer = keyObservers[j];
                if ( observer.object === null &&
                        observer.method === method ) {
                    keyObservers.splice( j, 1 );
                    break;
                }
            }
        } else if ( !pathObservers ) {
            pathObservers = metadata.pathObservers;
            if ( !metadata.hasOwnProperty( 'pathObservers' ) ) {
                pathObservers =
                    metadata.pathObservers = Object.create( pathObservers );
            }
            // We want to remove all path observers. Can't just delete though,
            // as it may be defined on the prototype object.
            pathObservers[ method ] = null;
            metadata.inits.Observers -= 1;
        }
    }
};

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
Function.prototype.observes = function () {
    var arguments$1 = arguments;

    var properties = ( this.observedProperties ||
        ( this.observedProperties = [] ) );
    var l = arguments.length;
    while ( l-- ) {
        properties.push( arguments$1[l] );
    }
    this.__setupProperty__ = setupObserver;
    this.__teardownProperty__ = teardownObserver;
    return this;
};

/**
    Method (private): O.ObservableProps-_setupTeardownPaths

    Adds or removes path observers for methods on an object.

    Parameters:
        obj    - {Object} The object to setup/teardown path observers for.
        method - {String} Either 'addObserverForPath' or 'removeObserverForPath'
*/
var _setupTeardownPaths = function ( obj, method ) {
    var pathObservers = meta( obj ).pathObservers;
    for ( var key in pathObservers ) {
        var paths = pathObservers[ key ];
        if ( paths ) {
            var l = paths.length;
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
    var observers = metadata.observers[ key ];
    var l;
    if ( observers && ( l = observers.length ) ) {
        var isInitialised = metadata.isInitialised;
        var haveCheckedForNew = false;
        // Remember, observers may be removed (or possibly added, but that's
        // less likely) during the iterations. Clone array before iterating
        // to avoid the problem.
        observers = observers.slice();
        while ( l-- ) {
            var observer = observers[l];
            var object = observer.object || that;
            var method = observer.method;
            // During initialisation, this method is only called when a
            // binding syncs. We want to give the illusion of the bound
            // properties being present on the object from the beginning, so
            // they can be used interchangably with non-bound properties, so
            // suppress notification of observers. However, if there is
            // another binding that is bound to this one, we need to notify
            // that to ensure it syncs the correct initial value.
            // We also need to set up any path observers correctly.
            var path = (void 0);
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
                if ( object instanceof Binding ) {
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
    var observers = metadata.observers[ '*' ];
    if ( observers ) {
        var l = observers.length;
        while ( l-- ) {
            var observer = observers[l];
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

var ObservableProps = {

    /**
        Method: O.Observable#initObservers

        Initialises any observed paths on the object (observed keys do not
        require initialisation. You should never call this directly, but rather
        iterate through the keys of `O.meta( this ).inits`, calling
        `this[ 'init' + key ]()` for all keys which map to truthy values.
    */
    initObservers: function initObservers () {
        _setupTeardownPaths( this, 'addObserverForPath' );
    },

    /**
        Method: O.Observable#destroyObservers

        Removes any observed paths from the object (observed keys do not require
        destruction. You should never call this directly, but rather iterate
        through the keys of `O.meta( this ).inits`, calling
        `this[ 'destroy' + key ]()` for all keys which map to a truthy value.
    */
    destroyObservers: function destroyObservers () {
        _setupTeardownPaths( this, 'removeObserverForPath' );
    },

    /**
        Method: O.ObservableProps#hasObservers

        Returns true if any property on the object is currently being observed
        by another object.

        Returns:
            {Boolean} Does the object have any observers?
    */
    hasObservers: function hasObservers () {
        var this$1 = this;

        var observers = meta( this ).observers;
        for ( var key in observers ) {
            var keyObservers = observers[ key ];
            var l = keyObservers.length;
            while ( l-- ) {
                var object = keyObservers[l].object;
                if ( object && object !== this$1 &&
                        // Ignore bindings that belong to the object.
                        !( ( object instanceof Binding ) &&
                             object.toObject === this$1 ) ) {
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
    beginPropertyChanges: function beginPropertyChanges () {
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
    endPropertyChanges: function endPropertyChanges () {
        var this$1 = this;

        var metadata = meta( this );
        if ( metadata.depth === 1 ) {
            // Notify observers.
            var changed;
            while ( changed = metadata.changed ) {
                metadata.changed = null;
                for ( var key in changed ) {
                    _notifyObserversOfKey( this$1, metadata,
                        key, changed[ key ].oldValue, changed[ key ].newValue );
                }
                // Notify observers interested in any property change
                if ( metadata.observers[ '*' ] ) {
                    _notifyGenericObservers( this$1, metadata, changed );
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
    propertyDidChange: function propertyDidChange ( key, oldValue, newValue ) {
        var this$1 = this;

        var metadata = meta( this );
        var isInitialised = metadata.isInitialised;
        var dependents = isInitialised ?
                this.propertiesDependentOnKey( key ) : [];
        var l = dependents.length;
        var depth = metadata.depth;
        var hasGenericObservers = metadata.observers[ '*' ];
        var fastPath = !l && !depth && !hasGenericObservers;
        var changed = fastPath ? null : metadata.changed || {};
        var cache = metadata.cache;

        if ( fastPath ) {
            _notifyObserversOfKey( this, metadata, key, oldValue, newValue );
        } else {
            while ( l-- ) {
                var prop = dependents[l];
                if ( !changed[ prop ] ) {
                    changed[ prop ] = {
                        oldValue: cache[ prop ],
                    };
                }
                delete cache[ prop ];
            }

            changed[ key ] = {
                oldValue: changed[ key ] ? changed[ key ].oldValue : oldValue,
                newValue: newValue,
            };

            if ( metadata.depth ) {
                metadata.changed = changed;
            } else {
                // Notify observers of dependent keys.
                for ( var prop$1 in changed ) {
                    _notifyObserversOfKey( this$1, metadata, prop$1,
                        changed[ prop$1 ].oldValue, changed[ prop$1 ].newValue );
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
    addObserverForKey: function addObserverForKey ( key, object, method ) {
        var observers = meta( this ).observers;
        var keyObservers = observers[ key ];
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
    removeObserverForKey: function removeObserverForKey ( key, object, method ) {
        var observers = meta( this ).observers;
        var keyObservers = observers[ key ];
        if ( keyObservers ) {
            var l = keyObservers.length;
            while ( l-- ) {
                var observer = keyObservers[l];
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
    addObserverForPath: function addObserverForPath ( path, object, method ) {
        var nextDot = path.indexOf( '.' );
        if ( nextDot === -1 ) {
            this.addObserverForKey( path, object, method );
        } else {
            var key = path.slice( 0, nextDot );
            var value = this.get( key );
            var restOfPath = path.slice( nextDot + 1 );
            var observers = meta( this ).observers;
            var keyObservers = observers[ key ];
            if ( !observers.hasOwnProperty( key ) ) {
                keyObservers = observers[ key ] = keyObservers ?
                    keyObservers.slice() : [];
            }

            keyObservers.push({
                path: restOfPath,
                object: object,
                method: method,
            });
            if ( value && !( value instanceof Binding ) ) {
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
    removeObserverForPath: function removeObserverForPath ( path, object, method ) {
        var nextDot = path.indexOf( '.' );
        if ( nextDot === -1 ) {
            this.removeObserverForKey( path, object, method );
        } else {
            var key = path.slice( 0, nextDot );
            var value = this.get( key );
            var restOfPath = path.slice( nextDot + 1 );
            var observers = meta( this ).observers;
            var keyObservers = observers[ key ];

            if ( keyObservers ) {
                var l = keyObservers.length;
                while ( l-- ) {
                    var observer = keyObservers[l];
                    if ( observer.path === restOfPath &&
                         observer.object === object &&
                         observer.method === method) {
                            keyObservers.splice( l, 1 );
                            break;
                    }
                }
                if ( !keyObservers.length ) {
                    delete observers[ key ];
                }
            }
            if ( value ) {
                value.removeObserverForPath( restOfPath, object, method );
            }
        }
        return this;
    },
};

// TODO(cmorgan/modulify): do something about these exports: Function#observes

/**
    Class: O.Object

    Includes: O.ComputedProps, O.BoundProps, O.ObservableProps, O.EventTarget

    This is the root class for almost every object in the rest of the library.
    It adds support for computed properties, bound properties, observable
    properties and subscribing/firing events.
*/
var Obj = Class({

    Mixin: [
        ComputedProps, BoundProps, ObservableProps, EventTarget ],

    /**
        Constructor: O.Object

        Parameters:
            ...mixins - {Object} (optional) Each argument passed will be treated
                        as an object, with any properties in that object added
                        to the new O.Object instance before initialisation (so
                        you can pass it getter/setter functions or observing
                        methods).
    */
    init: function init (/* ...mixins */) {
        var arguments$1 = arguments;
        var this$1 = this;

        this.isDestroyed = false;

        for ( var i = 0, l = arguments.length; i < l; i += 1 ) {
            mixin( this$1, arguments$1[i] );
        }

        var metadata = meta( this );
        var inits = metadata.inits;
        for ( var method in inits ) {
            if ( inits[ method ] ) {
                this$1[ 'init' + method ]();
            }
        }
        metadata.isInitialised = true;
    },

    /**
        Method: O.Object#destroy

        Removes any connections to other objects (e.g. path observers and
        bindings) so the object will be available for garbage collection.
    */
    destroy: function destroy () {
        var this$1 = this;

        var destructors = meta( this ).inits;
        for ( var method in destructors ) {
            if ( destructors[ method ] ) {
                this$1[ 'destroy' + method ]();
            }
        }

        this.isDestroyed = true;
    },
});

/**
    Mixin: O.ObservableRange

    The ObservableRange mixin adds support for observing an (integer-based)
    numerical range of keys to an observable object. The object is expected
    to have the ObservableProps mixin applied and have a length property.
*/

var ObservableRange = {
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
    rangeDidChange: function rangeDidChange ( start, end ) {
        var this$1 = this;

        if ( end === undefined ) {
            end = start + 1;
        }
        var metadata = meta( this );
        for ( var key in metadata.observers ) {
            var index = parseInt( key, 10 );
            if ( start <= index && index < end ) {
                this$1.propertyDidChange( key );
            }
        }
        var observers = metadata.rangeObservers;
        var l = observers ? observers.length : 0;
        var enumerableLength = this.get( 'length' ) || 0;
        while ( l-- ) {
            var observer = observers[l];
            var range = observer.range;
            var observerStart = range.start || 0;
            var observerEnd = 'end' in range ?
                    range.end : Math.max( enumerableLength, end );
            if ( observerStart < 0 ) {
                observerStart += enumerableLength;
            }
            if ( observerEnd < 0 ) {
                observerEnd += enumerableLength;
            }
            if ( observerStart < end && observerEnd > start ) {
                observer.object[ observer.method ]( this$1, start, end );
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
    addObserverForRange: function addObserverForRange ( range, object, method ) {
        var metadata = meta( this );
        ( metadata.rangeObservers || ( metadata.rangeObservers = [] ) ).push({
            range: range,
            object: object,
            method: method,
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
    removeObserverForRange: function removeObserverForRange ( range, object, method ) {
        var observers = meta( this ).rangeObservers;
        var l = observers ? observers.length : 0;
        while ( l-- ) {
            var observer = observers[l];
            if ( observer.range === range &&
                 observer.object === object && observer.method === method ) {
                    observers.splice( l, 1 );
                    break;
            }
        }
        return this;
    },

    /**
        Method: O.ObservableRange#hasRangeObservers

        Returns true a range is being observed on the object by another object.

        Returns:
            {Boolean} Does the object have any range observers?
    */
    hasRangeObservers: function hasRangeObservers () {
        var this$1 = this;

        var observers = meta( this ).rangeObservers;
        var l = observers ? observers.length : 0;
        while ( l-- ) {
            var object = observers[l].object;
            if ( object && object !== this$1 ) {
                return true;
            }
        }
        return false;
    },
};

var splice = Array.prototype.splice;
var slice$3 = Array.prototype.slice;

/**
    Class: O.ObservableArray

    Extends: O.Object

    Includes: O.ObservableRange, O.Enumerable, O.MutableEnumerable

    The ObservableArray class provides an object with the same interface as the
    standard array but with the difference that properties or even ranges can be
    observed. Note, all access must be via getObjectAt/setObjectAt, not direct
    array[i].
*/
var ObservableArray = Class({

    Extends: Obj,

    Mixin: [ ObservableRange, Enumerable, MutableEnumerable ],

    /**
        Constructor: O.ObservableArray

        Parameters:
            array   - {Array} (optional) The initial contents of the array.
            ...mixins - {Object} (optional)
    */
    init: function init ( array /*, ...mixins */) {
        this._array = array || [];
        this._length = this._array.length;

        ObservableArray.parent.constructor.apply( this,
            Array.prototype.slice.call( arguments, 1 ) );
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
            var oldArray = this._array;
            var oldLength = this._length;
            var newLength = array.length;
            var start = 0;
            var end = newLength;

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
    getObjectAt: function getObjectAt ( index ) {
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
    setObjectAt: function setObjectAt ( index, value ) {
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
    replaceObjectsAt: function replaceObjectsAt ( index, numberRemoved, newItems ) {
        var oldLength = this._length;
        var array = this._array;
        var removed;

        newItems = newItems ? slice$3.call( newItems ) : [];

        if ( oldLength <= index ) {
            var l = newItems.length;
            for ( var i = 0; i < l; i += 1 ) {
                array[ index + i ] = newItems[i];
            }
        } else {
            newItems.unshift( index, numberRemoved );
            removed = splice.apply( array, newItems );
        }
        var newLength = array.length;
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
    sort: function sort ( comparefn ) {
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
    reverse: function reverse () {
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
    concat: function concat () {
        var arguments$1 = arguments;

        var args = [];
        var l = arguments.length;
        for ( var i = 0; i < l; i += 1 ) {
            var item = arguments$1[i];
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
    join: function join ( separator ) {
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
    slice: function slice ( start, end ) {
        return this._array.slice( start, end );
    },
});

/**
    Namespace: O.Transform

    Holds a number of useful functions for transforming values, for use with
    <O.Binding>.
*/
var Transform = {
    /**
        Function: O.Transform.toBoolean

        Converts the given value to a Boolean

        Parameter:
            value - {*} The value to transform.

        Returns:
            {Boolean} The numerical value.
    */
    toBoolean: function toBoolean ( value ) {
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
    toString: function toString ( value ) {
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
    toInt: function toInt ( value ) {
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
    toFloat: function toFloat ( value ) {
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
    invert: function invert ( value ) {
        return !value;
    },

    /**
        Function: O.Transform#defaultValue

        Returns a function which will transform `undefined` into the default
        value, but will pass through any other value untouched.

        Parameters:
            value - {*} The default value to use.
    */
    defaultValue: function defaultValue ( value ) {
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
    undefinedToNull: function undefinedToNull ( value ) {
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
    isEqualToValue: function isEqualToValue ( value ) {
        return function ( syncValue, syncForward ) {
            return syncForward ?
                syncValue === value :
                syncValue ? value : undefined;
        };
    },
};

var NativePromise = Promise;
var NativePromisePrototype = NativePromise.prototype;

/**
    Class: O.Promise
    Extends: Promise

    This is a small extension of the native `Promise` that runs the asynchronous
    onFulfilled and onRejected functions in the run loop.

    It is intended to supplant the global `Promise`.
*/
/*
    Implementation note: with class syntax, parts work just fine and dandy; but
    when you transpile class syntax to the older function syntax, it breaks: the
    constructor looks like this:

        function OPromise () {
            NativePromise.apply(this, arguments);
        }

    And browsers don’t like that; Firefox’s opinion is: “TypeError: calling a
    builtin Promise constructor without new is forbidden”.

    (Similarly, using static methods like `OPromise.then()` break without the
    static method declarations. Native functionality is often weird. ☹)

    So because we still care about IE 11 which doesn’t support class syntax,
    we are constrained to use a different technique for the constructor, one
    which is incompatible with class syntax, and so the entire thing stops
    working as a class. ☹
*/
var OPromise = Object.setPrototypeOf( function OPromise ( executor ) {
    return Object.setPrototypeOf( new NativePromise( executor ),
        OPromise.prototype );
}, NativePromise );

Object.assign( OPromise, {
    prototype: Object.assign( Object.create( NativePromisePrototype ), {
        constructor: OPromise,

        then: function then ( onFulfilled, onRejected ) {
            return NativePromisePrototype.then.call( this,
                typeof onFulfilled === 'function' ?
                    onFulfilled.invokeInRunLoop() :
                    onFulfilled,
                typeof onRejected === 'function' ?
                    onRejected.invokeInRunLoop() :
                    onRejected );
        },
    }),


    all: function all ( iterable ) {
        return NativePromise.all.call( this, iterable );
    },

    race: function race ( iterable ) {
        return NativePromise.race.call( this, iterable );
    },

    reject: function reject ( reason ) {
        return NativePromise.reject.call( this, reason );
    },

    resolve: function resolve ( value ) {
        return NativePromise.resolve.call( this, value );
    },
});

/*global navigator, document, window */

// TODO(cmorgan/modulify) remove this alleged dependency, we use a ES5 baseline.

/**
    Module: UA

    The UA module contains information about the platform on which the
    application is running.
*/

var ua = navigator.userAgent.toLowerCase();
var other = [ 'other', '0' ];
var platform = /windows phone/.test( ua ) ? 'winphone' :
    /ip(?:ad|hone|od)/.test( ua ) ? 'ios' : (
    /android|webos/.exec( ua ) ||
    /mac|win|linux/.exec( navigator.platform.toLowerCase() ) ||
    other
)[0];
var browser = (
    /firefox|edge|msie|iemobile|opr\//.exec( ua ) ||
    /chrome|safari|opera/.exec( ua ) ||
    other
)[0];
var version = parseFloat((
    /(?:; rv:|edge\/|version\/|firefox\/|opr\/|msie\s|os )(\d+(?:[._]\d+)?)/
        .exec( ua ) ||
    /chrome\/(\d+\.\d+)/.exec( ua ) ||
    other
)[1].replace( '_', '.' ) );
var prefix = {
    firefox: '-moz-',
    msie: '-ms-',
    opera: '-o-',
}[ browser ] || '-webkit-';
var cssProps = {};

if ( browser === 'opr/' ) {
    browser = 'opera';
}

( function () {
    var props = {
        'box-shadow': {
            name: 'box-shadow',
            value: '0 0 0 #000',
        },
        transform: {
            name: 'transform',
            value: 'translateX(0)',
        },
        transform3d: {
            name: 'transform',
            value: 'translateZ(0)',
        },
        transition: {
            name: 'transition',
            value: 'all .3s',
        },
        perspective: {
            name: 'perspective',
            value: '1px',
        },
        'user-select': {
            name: 'user-select',
            value: 'none',
        },
    };
    var el = document.createElement( 'div' );
    var style = el.style;

    for ( var prop in props ) {
        var test = props[ prop ];
        var css$1 = style.cssText = test.name + ':' + test.value;
        if ( style.length ) {
            cssProps[ prop ] = test.name;
        } else {
            style.cssText = prefix + css$1;
            cssProps[ prop ] = style.length ? prefix + test.name : null;
        }
    }
    style.cssText = 'display:flex';
    if ( style.length ) {
        cssProps.flexbox = 'flex';
    } else {
        style.cssText = 'display:' + prefix + 'flex';
        cssProps.flexbox = style.length ? prefix + 'flex' : null;
    }
    var css = cssProps.transition;
    [ 'delay', 'timing', 'duration', 'property' ].forEach( function (prop) {
        cssProps[ 'transition-' + prop ] = css ? css + '-' + prop : null;
    });

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
var UA = {
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
        Property: O.UA.isWKWebView
        Type: Boolean

        True if running on WKWebView in iOS.
    */
    isWKWebView: platform === 'ios' && !!window.indexedDB,
    /**
        Property: O.UA.isAndroid
        Type: Boolean

        True if running on Android.
    */
    isAndroid: platform === 'android',
    /**
        Property: O.UA.isWinPhone
        Type: Boolean

        True if running on Windows Phone.
    */
    isWinPhone: platform === 'winphone',

    /**
        Property: O.UA.browser
        Type: String

        The browser being run. "chrome", "firefox", "msie", "edge", "opera",
        "safari" or "iemobile".
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
        Property: O.UA.safari
        Type: Number

        If running Safari, this will be the version number running. Otherwise 0.
    */
    safari: browser === 'safari' ? version : 0,
    /**
        Property: O.UA.firefox
        Type: Number

        If running Firefox, this will be the version number running. Otherwise
        0.
    */
    firefox: browser === 'firefox' ? version : 0,
    /**
        Property: O.UA.edge
        Type: Number

        If running Edge, this will be the version number running. Otherwise
        0.
    */
    edge: browser === 'edge' ? version : 0,
    /**
        Property: O.UA.msie
        Type: Number

        If running Internet Explorer, this will be the version number running.
        Otherwise 0.
    */
    msie: browser === 'msie' ? version : 0,
    /**
        Property: O.UA.iemobile
        Type: Number

        If running Mobile Internet Explorer, this will be the version number
        running. Otherwise 0.
    */
    iemobile: browser === 'iemobile' ? version : 0,
    /**
        Property: O.UA.opera
        Type: Number

        If running Opera, this will be the version number running. Otherwise 0.
    */
    opera: browser === 'opera' ? version : 0,
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
    operaMini: window.operamini ? version : 0,

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
    cssPrefix: prefix,

    /**
        Property: O.UA.canTouch
        Type: Boolean

        Does the browser support touch events?
    */
    canTouch: 'ontouchstart' in document.documentElement,

    /**
        Property: O.UA.canU2F
        Type: Boolean

        Does the browser support U2F?
    */
    // TODO: Find a way of detecting this rather than hardcoding
    // For now, referencing http://caniuse.com/#feat=u2f
    canU2F: browser === 'chrome' && version >= 41,
};

/**
    Property: O.activeViews
    Type: O.Object

    Maps from id to the view object for all views currently in a document.

    Views with a manually specified ID are added using <O.ComputedProps#set>,
    and so you can observe them.

    For reasons of performance, views with automatically-generated IDs ('v1',
    'v372', &c.) bypass <O.ComputedProps#set>, and so they cannot be observed.
    (I can’t think of any legitimate reasons for observing them anyway.)

    This object is maintained by <O.View#didEnterDocument> and
    <O.View#willLeaveDocument>; no code outside of those two methods is
    permitted to mutate it.
*/
var activeViews = new Obj();
/**
    Function: O.getViewFromNode

    Returns the view object that the given DOM node is a part of.

    Parameters:
        node - {Element} a DOM node.

    Returns:
        {O.View|null} The view which owns the node.
*/
var getViewFromNode = function ( node ) {
    var doc = node.ownerDocument;
    var view = null;
    while ( !view && node && node !== doc ) {
        view = activeViews[ node.id ] || null;
        node = node.parentNode;
    }
    return view;
};

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
    addEventTarget: function addEventTarget ( eventTarget, priority ) {
        if ( !priority ) {
            priority = 0;
        }
        var eventTargets = this._eventTargets.slice();
        var index = eventTargets.binarySearch( priority, etSearch );
        var length = eventTargets.length;

        while ( index < length && eventTargets[ index ][0] === priority ) {
            index += 1;
        }

        eventTargets.splice( index, 0, [ priority, eventTarget ] );
        this._eventTargets = eventTargets;

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
    removeEventTarget: function removeEventTarget ( eventTarget ) {
        this._eventTargets = this._eventTargets.filter(
            function (target) { return target[1] !== eventTarget; }
        );
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
        var this$1 = this;

        var eventTargets = this._eventTargets;
        var l = eventTargets.length;

        if ( !view ) {
            view = getViewFromNode( event.target ) || _rootView;
        }
        event.targetView = view;

        while ( l-- ) {
            var eventTarget = eventTargets[l][1];
            if ( eventTarget === this$1 ) {
                eventTarget = view;
            }
            if ( eventTarget ) {
                eventTarget.fire( event.type, event );
                if ( event.propagationStopped ) {
                    break;
                }
            }
        }
    }.invokeInRunLoop(),
};
ViewEventsController.addEventTarget( ViewEventsController, 0 );

var UID = 0;

var POSITION_SAME = 0x00;
var POSITION_DISCONNECTED = 0x01;
var POSITION_PRECEDING = 0x02;
var POSITION_FOLLOWING = 0x04;
var POSITION_CONTAINS = 0x08;
var POSITION_CONTAINED_BY = 0x10;

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
            draw( layer, Element, el ) {
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
            },
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
            draw( layer, Element, el ) {
                const content = this.get( 'content' );
                return [
                    el( 'h1#title', {
                        className: O.bind( content, 'isDone',
                            isDone => isDone ? 'done' : 'todo' ),
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

var isRedrawingLayer = false;

var View = Class({

    Extends: Obj,

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

    init: function init (/* ...mixins */) {
        var this$1 = this;

        this._suspendRedraw = false;
        this._needsRedraw = null;

        this.parentView = null;
        this.isRendered = false;
        this.isInDocument = false;

        View.parent.constructor.apply( this, arguments );

        if ( ( this._autoID = !this.get( 'id' ) ) ) {
            this.set( 'id', 'v' + UID++ );
        }

        var children = this.get( 'childViews' ) || ( this.childViews = [] );
        var l = children.length;
        while ( l-- ) {
            children[l].set( 'parentView', this$1 );
        }
        if ( this.get( 'syncOnlyInDocument' ) ) {
            this.suspendBindings();
        }
    },

    destroy: function destroy () {
        if ( this.get( 'isInDocument' ) ) {
            throw new Error( 'Cannot destroy a view in the document' );
        }

        var children = this.get( 'childViews' );
        var l = children.length;
        while ( l-- ) {
            children[l].destroy();
        }
        if ( this.get( 'isRendered' ) ) {
            this.willDestroyLayer( this.get( 'layer' ) );
        }
        this.clearPropertyCache();
        View.parent.destroy.call( this );
    },

    suspend: function suspend () {
        if ( !this._suspendRedraw ) {
            this.suspendBindings();
            this._suspendRedraw = true;
        }
        return this;
    },

    resume: function resume () {
        if ( this._suspendRedraw ) {
            this._suspendRedraw = false;
            this.resumeBindings();
            if ( this._needsRedraw && this.get( 'isInDocument' ) ) {
                RunLoop.queueFn( 'render', this.redraw, this );
            }
        }
        return this;
    },

    // --- Screen reader accessibility ---

    /**
        Property: O.View#ariaAttributes
        Type: Object|null

        A set of aria attributes to apply to the layer node. The key is the name
        of the attribute, excluding the 'aria-' prefix. The role attribute can
        also be set here.

        It’s *possible* for a view to set ARIA attributes on the layer in other
        places, so long as they never appear in this property, but that feels
        like a bad idea. Just let this property control all the ARIA attributes;
        life will be easier for you if you do this.

        Example value:

            {
                role: 'menu',
                modal: 'true'
            }
    */
    ariaAttributes: null,

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
        var layer = Element$1.create( this.get( 'layerTag' ), {
            id: this.get( 'id' ),
            className: this.get( 'className' ),
            style: Object.toCSSString( this.get( 'layerStyles' ) ),
        });
        this.didCreateLayer( layer );
        this.redrawAriaAttributes( layer );
        return layer;
    }.property(),

    /**
        Method: O.View#didCreateLayer

        Called immediately after the layer is created. By default does nothing.

        Parameters:
            layer - {Element} The DOM node.
    */
    didCreateLayer: function didCreateLayer (/* layer */) {},

    /**
        Method: O.View#willDestroyLayer

        Called immediately before the layer is destroyed.

        Parameters:
            layer - {Element} The DOM node.
    */
    willDestroyLayer: function willDestroyLayer (/* layer */) {
        this.set( 'isRendered', false );
    },

    /**
        Method: O.View#willEnterDocument

        Called immediately before the layer is appended to the document.

        Returns:
            {O.View} Returns self.
    */
    willEnterDocument: function willEnterDocument () {
        if ( this.get( 'syncOnlyInDocument' ) ) {
            this.resume();
        }

        if ( this._needsRedraw ) {
            this.redraw();
        }

        // Must iterate forward and not cache childViews or length.
        // Switch views may append extra child views when they are rendered.
        var childViews = this.get( 'childViews' );
        for ( var i = 0; i < childViews.length; i += 1 ) {
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
    didEnterDocument: function didEnterDocument () {
        // If change was made since willEnterDocument, will not be
        // flushed, so add redraw to render queue.
        if ( this._needsRedraw ) {
            RunLoop.queueFn( 'render', this.redraw, this );
        }
        this.set( 'isInDocument', true );

        var id = this.get( 'id' );
        if ( this._autoID ) {
            // Automatically-generated ID: bypass `set` for performance.
            activeViews[ id ] = this;
        } else {
            activeViews.set( id, this );
        }

        this.computedPropertyDidChange( 'pxLayout' );

        var childViews = this.get( 'childViews' );
        for ( var i = 0; i < childViews.length; i += 1 ) {
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
    willLeaveDocument: function willLeaveDocument () {
        this.set( 'isInDocument', false );

        var id = this.get( 'id' );
        if ( this._autoID ) {
            // Automatically-generated ID: bypass `set` for performance.
            delete activeViews[ id ];
        } else {
            activeViews.set( id, null );
        }

        var children = this.get( 'childViews' );
        var l = children.length;
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
    didLeaveDocument: function didLeaveDocument () {
        var children = this.get( 'childViews' );
        var l = children.length;
        while ( l-- ) {
            children[l].didLeaveDocument();
        }
        if ( this.get( 'syncOnlyInDocument' ) ) {
            this.suspend();
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
    handleEvent: function handleEvent ( event ) {
        ViewEventsController.handleEvent( event );
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
        return Object.assign({
            position: this.get( 'positioning' ),
        }, this.get( 'layout' ) );
    }.property( 'layout', 'positioning' ),

    /**
        Method: O.View#render

        Ensure the view is rendered. Has no effect if the view is already
        rendered.

        Returns:
            {O.View} Returns self.
    */
    render: function render () {
        if ( !this.get( 'isRendered' ) ) {
            // render() called just before inserting in doc, so should
            // resume bindings early to ensure initial render is correct.
            if ( this.get( 'syncOnlyInDocument' ) ) {
                this.resumeBindings();
            }
            this.set( 'isRendered', true );
            var prevView = Element$1.forView( this );
            var layer = this.get( 'layer' );
            var children = this.draw( layer, Element$1, Element$1.create );
            if ( children ) {
                Element$1.appendChildren( layer, children );
            }
            Element$1.forView( prevView );
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
    draw: function draw (/* layer, Element, el */) {
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
        var this$1 = this;

        if ( this.get( 'isRendered' ) ) {
            var needsRedraw = this._needsRedraw || ( this._needsRedraw = [] );
            var i, l;
            for ( i = 0, l = needsRedraw.length; i < l; i += 1 ) {
                if ( needsRedraw[i][0] === layerProperty ) {
                    return this$1;
                }
            }
            needsRedraw[l] = [
                layerProperty,
                oldProp ];
            if ( !this._suspendRedraw && this.get( 'isInDocument' ) ) {
                RunLoop.queueFn( 'render', this.redraw, this );
            }
        }
        return this;
    }.observes( 'className', 'layerStyles', 'ariaAttributes' ),

    /**
        Method: O.View#redraw

        Updates the rendering of the view to account for any changes in the
        state of the view. By default, just calls
        `this.redraw<Property>( layer, oldValue )` for each property that has
        been passed to <O.View#propertyNeedsRedraw>.

        Returns:
            {O.View} Returns self.
    */
    redraw: function redraw () {
        var this$1 = this;

        var needsRedraw = this._needsRedraw;
        var layer, i, l, prop;
        if ( needsRedraw && !this._suspendRedraw &&
                !this.isDestroyed && this.get( 'isRendered' ) ) {
            layer = this.get( 'layer' );
            this._needsRedraw = null;
            for ( i = 0, l = needsRedraw.length; i < l; i += 1 ) {
                prop = needsRedraw[i];
                this$1[ 'redraw' + prop[0].capitalise() ]( layer, prop[1] );
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
    redrawLayer: function redrawLayer ( layer ) {
        var this$1 = this;

        var prevView = Element$1.forView( this );
        var childViews = this.get( 'childViews' );
        var l = childViews.length;
        var node, view;

        while ( l-- ) {
            view = childViews[l];
            this$1.removeView( view );
            view.destroy();
        }
        while (( node = layer.lastChild )) {
            layer.removeChild( node );
        }

        isRedrawingLayer = true;
        Element$1.appendChildren( layer,
            this.draw( layer, Element$1, Element$1.create )
        );
        isRedrawingLayer = false;

        if ( this.get( 'isInDocument' ) ) {
            childViews = this.get( 'childViews' );
            for ( var i = 0; i < childViews.length; i += 1 ) {
                childViews[i].didEnterDocument();
            }
        }

        Element$1.forView( prevView );
    },

    /**
        Method: O.View#redrawClassName

        Sets the className on the layer to match the className property of the
        view. Called automatically when the className property changes.

        Parameters:
            layer - {Element} The view's layer.
    */
    redrawClassName: function redrawClassName ( layer ) {
        var className = this.get( 'className' );
        if ( className !== undefined ) {
            layer.className = className;
        }
    },

    /**
        Method: O.View#redrawLayerStyles

        Sets the style attribute on the layer to match the layerStyles property
        of the view. Called automatically when the layerStyles property changes.

        Parameters:
            layer - {Element} The view's layer.
    */
    redrawLayerStyles: function redrawLayerStyles ( layer ) {
        layer.style.cssText = Object.toCSSString( this.get( 'layerStyles' ) );
        this.parentViewDidResize();
    },

    /**
        Method: O.View#redrawAriaAttributes

        Sets the ARIA attributes on the layer to match the ariaAttributes
        property of the view. Called automatically when the ariaAttributes
        property changes.

        Parameters:
            layer - {Element} The view's layer.
            oldAriaAttributes - {undefined|null|Object} The previous value.
    */
    redrawAriaAttributes: function redrawAriaAttributes ( layer, oldAriaAttributes ) {
        var ariaAttributes = this.get( 'ariaAttributes' );
        // Step one: remove any now-excluded ARIA attributes from the layer.
        for ( var attribute in oldAriaAttributes ) {
            if ( !ariaAttributes || !( attribute in ariaAttributes ) ) {
                if ( attribute !== 'role' ) {
                    attribute = 'aria-' + attribute;
                }
                layer.removeAttribute( attribute );
            }
        }
        // Step two: now set (adding or replacing) the attributes we want.
        for ( var attribute$1 in ariaAttributes ) {
            var value = ariaAttributes[ attribute$1 ];
            if ( attribute$1 !== 'role' ) {
                attribute$1 = 'aria-' + attribute$1;
            }
            layer.setAttribute( attribute$1, value );
        }
    },

    // --- Dimensions ---

    /**
        Method: O.View#parentViewDidResize

        Called automatically whenever the parent view resizes. Rather than
        override this method, you should normally observe the <O.View#pxLayout>
        property if you're interested in changes to the view size.
    */
    parentViewDidResize: function parentViewDidResize () {
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
    didResize: function didResize () {
        this.computedPropertyDidChange( 'pxLayout' );
        var children = this.get( 'childViews' );
        var l = children.length;
        while ( l-- ) {
            children[l].didResize();
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
            height: this.get( 'pxHeight' ),
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
        var parent = this.get( 'parentView' ).get( 'layer' );
        var parentOffsetParent = parent.offsetParent;
        var layer = this.get( 'layer' );
        var offset = 0;
        do {
            if ( layer === parentOffsetParent ) {
                offset -= parent.offsetTop;
                break;
            }
            offset += layer.offsetTop;
        } while ( ( layer = layer.offsetParent ) && ( layer !== parent ) );
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
        var parent = this.get( 'parentView' ).get( 'layer' );
        var parentOffsetParent = parent.offsetParent;
        var layer = this.get( 'layer' );
        var offset = 0;
        do {
            if ( layer === parentOffsetParent ) {
                offset -= parent.offsetLeft;
                break;
            }
            offset += layer.offsetLeft;
        } while ( ( layer = layer.offsetParent ) && ( layer !== parent ) );
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
            height: this.get( 'pxHeight' ),
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
            number of pixels this view is offset from the given view, and
            'width' and 'height' properties for the dimensions of this view.
    */
    getPositionRelativeTo: function getPositionRelativeTo ( view ) {
        // If it's a scroll view, it may not have synced the current scroll
        // positions yet. Force this.
        // We also need to force a redraw in case the reverse is true:
        // scroll(Top|Left) properties have changed but DOM not yet updated.
        if ( view.syncBackScroll ) {
            view.syncBackScroll();
            view.redraw();
        }
        this.redraw();
        var getPosition = Element$1.getPosition;
        var selfPosition = getPosition( this.get( 'layer' ) );
        var viewPosition = getPosition( view.get( 'layer' ) );
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
    insertView: function insertView ( view, relativeTo, where ) {
        var oldParent = view.get( 'parentView' );
        var childViews = this.get( 'childViews' );
        var index, isInDocument, layer, parent, before;

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
        } else if ( where === 'top' ) {
            childViews.unshift( view );
        } else {
            childViews.push( view );
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
            if ( isInDocument && !isRedrawingLayer ) {
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
    replaceView: function replaceView ( view, oldView ) {
        if ( view === oldView ) {
            return this;
        }
        var children = this.get( 'childViews' );
        var i = children.indexOf( oldView );
        var oldParent = view.get( 'parentView' );
        if ( i === -1 ) {
            return this;
        }

        if ( oldParent ) {
            oldParent.removeView( view );
        }
        view.set( 'parentView', this );
        children.setObjectAt( i, view );

        if ( this.get( 'isRendered' ) ) {
            var isInDocument = this.get( 'isInDocument' );
            var oldLayer = oldView.get( 'layer' );
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
    removeView: function removeView ( view ) {
        var children = this.get( 'childViews' );
        var i = children.lastIndexOf( view );
        var isInDocument, layer;

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

    detach: function detach () {
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
    compareViewTreePosition: function compareViewTreePosition ( b ) {
        if ( this === b ) {
            return POSITION_SAME;
        }

        var a = this;
        var aParents = [a];
        var bParents = [b];
        var parent = a;
        var al, bl, children, l, view;

        while ( ( parent = parent.get( 'parentView' ) ) ) {
            if ( parent === b ) {
                return POSITION_CONTAINED_BY;
            }
            aParents.push( parent );
        }
        parent = b;
        while ( ( parent = parent.get( 'parentView' ) ) ) {
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
                }
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
    getParent: function getParent ( Type ) {
        var parent = this;
        do {
            parent = parent.get( 'parentView' );
        } while ( parent && !( parent instanceof Type ) );
        return parent || null;
    },

    /**
        Method: O.View#getParentWhere

        Finds the nearest ancestor in the view hierarchy which satisfies the
        given condition function.

        Parameters:
            condition - {function( View ) -> boolean} The function to check
                        against each ancestor view; if this function returns
                        true, that view will be returned.

        Returns:
            {(O.View|null)} Returns the nearest parent view for which the
            condition function returns true, or null if the condition function
            never returns true.
    */
    getParentWhere: function getParentWhere ( condition ) {
        var parent = this;
        do {
            parent = parent.get( 'parentView' );
        } while ( parent && !condition( parent ) );
        return parent || null;
    },
});

// Expose Globals:

View.LAYOUT_FILL_PARENT = {
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
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

/*global Element, document */

/**
    Module: DOM

    The DOM module provides helper functions and classes for dealing with the
    DOM.
*/

/**
    Namespace: O.Element

    The O.Element namespace contains a number of helper functions for dealing
    with DOM elements.
*/

// Vars used to store references to fns so they can call each other.
var setStyle;
var setStyles;
var setAttributes;
var appendChildren;
var getPosition;

/**
    Property (private): Element-directProperties
    Type: Object

    Any names that match keys in this map will be set as direct properties
    rather than as attributes on the element.
*/
var directProperties = {
    // Note: SVGElement#className is an SVGAnimatedString.
    'class': 'className',
    className: 'className',
    defaultValue: 'defaultValue',
    'for': 'htmlFor',
    html: 'innerHTML',
    text: 'textContent',
    unselectable: 'unselectable',
    value: 'value',
};

/**
    Property (private): Element-svgTagNames
    Type: Set

    When creating inline SVG elements the SVG namespace must be used. This list
    allows `Element.create` to handle SVG tag names transparently.

    Note that `title` is included in this, because we don’t expect Overture to
    ever be creating HTML `<title>` elements.

    Note that SVG attributes don’t use a namespace; only the element needs it.
    That simplifies things a bit.
*/
// I took this list from html.vim; it probably covers SVG 1.1 completely.
var svgTagNames = new Set([
    'svg', 'altGlyph', 'altGlyphDef', 'altGlyphItem', 'animate', 'animateColor',
    'animateMotion', 'animateTransform', 'circle', 'ellipse', 'rect', 'line',
    'polyline', 'polygon', 'image', 'path', 'clipPath', 'color-profile',
    'cursor', 'defs', 'desc', 'g', 'symbol', 'view', 'use', 'switch',
    'foreignObject', 'filter', 'feBlend', 'feColorMatrix',
    'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
    'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feFlood',
    'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage',
    'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
    'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'font',
    'font-face', 'font-face-format', 'font-face-name', 'font-face-src',
    'font-face-uri', 'glyph', 'glyphRef', 'hkern', 'linearGradient', 'marker',
    'mask', 'pattern', 'radialGradient', 'set', 'stop', 'missing-glyph',
    'mpath', 'text', 'textPath', 'tref', 'tspan', 'vkern', 'metadata', 'title' ]);

/**
    Property (private): Element-svgNS
    Type: String

    The URL for the SVG XML namespace.
*/
var svgNS = 'http://www.w3.org/2000/svg';

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
    selected: 1,
    webkitdirectory: 1,
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
    if ( prop ) {
        var value = this[ prop ];
        return ( value instanceof SVGAnimatedString ) ? value.animVal : value;
    }
    return booleanProperties[ key ] ?
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
    var this$1 = this;

    var prop = directProperties[ key ];
    if ( prop ) {
        var currentValue = this[ prop ];
        value = value == null ? '' : '' + value;
        if ( currentValue instanceof SVGAnimatedString ) {
            currentValue.baseVal = value;
        } else {
            this[ prop ] = value;
        }
    } else if ( booleanProperties[ key ] ) {
        this[ key ] = !!value;
    } else if ( key === 'styles' ) {
        setStyles( this, value );
    } else if ( key === 'children' ) {
        var child;
        while ( child = this.lastChild ) {
            this$1.removeChild( child );
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
    zIndex: 1,
};

/**
    Property (private): Element-styleNames
    Type: Object

    Map of normal CSS names to the name used on the style object.
*/
var styleNames = {
    'float': document.body.style.cssFloat !== undefined ?
        'cssFloat' : 'styleFloat',
};
var styles = UA.cssProps;
for ( var property in styles ) {
    var style = styles[ property ];
    if ( style ) {
        style = style.camelCase();
        // Stupid MS, don't follow convention.
        if ( style.slice( 0, 2 ) === 'Ms' ) {
            style = 'm' + style.slice( 1 );
        }
        styleNames[ property.camelCase() ] = style;
    }
}

/**
    Property (private): O.Element-doc
    Type: Document

    A reference to the document object.
*/
var doc = document;

// = Node.DOCUMENT_POSITION_CONTAINED_BY
var DOCUMENT_POSITION_CONTAINED_BY = 16;

var view = null;

var Element$1 = {
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
    forView: function forView ( newView ) {
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
    create: function create ( tag, props, children ) {
        if ( props instanceof Array ) {
            children = props;
            props = null;
        }

        // Parse id/class names out of tag.
        if ( /[#.]/.test( tag ) ) {
            var parts = tag.split( /([#.])/ );
            tag = parts[0];
            if ( !props ) {
                props = {};
            }
            var l = parts.length;
            for ( var i = 1; i + 1 < l; i += 2 ) {
                var name = parts[ i + 1 ];
                if ( parts[i] === '#' ) {
                    props.id = name;
                } else {
                    props.className = props.className ?
                        props.className + ' ' + name : name;
                }
            }
        }

        // Create element with default or SVG namespace, as appropriate.
        var el = svgTagNames.has( tag ) ?
            doc.createElementNS( svgNS, tag ) :
            doc.createElement( tag );

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
        for ( var prop in props ) {
            var value = props[ prop ];
            if ( value !== undefined ) {
                if ( value instanceof Binding ) {
                    value.to( prop, el ).connect();
                    if ( view ) {
                        view.registerBinding( value );
                    }
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
        if ( !( children instanceof Array ) ) {
            children = [ children ];
        }
        for ( var i = 0, l = children.length; i < l; i += 1 ) {
            var node = children[i];
            if ( node ) {
                if ( node instanceof Array ) {
                    appendChildren( el, node );
                } else if ( node instanceof View ) {
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
                RunLoop.didError({
                    name: 'Element#setStyle',
                    message: 'Invalid value set',
                    details:
                        'Style: ' + style +
                      '\nValue: ' + value +
                      '\nEl id: ' + el.id +
                      '\nEl class: ' + el.className,
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
    contains: function contains ( el, potentialChild ) {
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
    nearest: function nearest ( el, test, limit ) {
        if ( !limit ) {
            limit = el.ownerDocument.documentElement;
        }
        if ( typeof test === 'string' ) {
            var nodeName = test.toUpperCase();
            test = function (el) { return el.nodeName === nodeName; };
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
            given ancestor or the whole page, plus the height and width.
            Has four properties:

            - top: `Number`
            - left: `Number`
            - width: `Number`
            - height: `Number`
    */
    getPosition: getPosition = function ( el, ancestor ) {
        var rect = el.getBoundingClientRect();
        var position = {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
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
    },
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
    var result = '';
    for ( var key in object ) {
        var value = object[ key ];
        if ( value !== undefined ) {
            if ( typeof value === 'number' && !cssNoPx[ key ] ) {
                value += 'px';
            }
            key = key.hyphenate();
            key = UA.cssProps[ key ] || key;
            result += key;
            result += ':';
            result += value;
            result += ';';
        }
    }
    return result;
};

// TODO(cmorgan/modulify): do something about these exports: Object.toCSSString
// Element#get, Element#set

var cubicBezier = function ( p1x, p1y, p2x, p2y ) {
    // Calculate constants in parametric bezier formular
    // http://www.moshplant.com/direct-or/bezier/math.html
    var cX = 3 * p1x;
    var bX = 3 * ( p2x - p1x ) - cX;
    var aX = 1 - cX - bX;

    var cY = 3 * p1y;
    var bY = 3 * ( p2y - p1y ) - cY;
    var aY = 1 - cY - bY;

    // Functions for calculating x, x', y for t
    var bezierX = function (t) { return t * ( cX + t * ( bX + t * aX ) ); };
    var bezierXDerivative = function (t) { return cX + t * ( 2 * bX + 3 * aX * t ); };

    // Use Newton-Raphson method to find t for a given x.
    // Since x = a*t^3 + b*t^2 + c*t, we find the root for
    // a*t^3 + b*t^2 + c*t - x = 0, and thus t.
    var newtonRaphson = function (x) {
        var prev;
        // Initial estimation is linear
        var t = x;
        do {
            prev = t;
            t = t - ( ( bezierX( t ) - x ) / bezierXDerivative( t ) );
        } while ( Math.abs( t - prev ) > 1e-4 );

        return t;
    };

    var output = function (x) {
        var t = newtonRaphson( x );
        // This is y given t on the bezier curve.
        return t * ( cY + t * ( bY + t * aY ) );
    };
    output.cssName = 'cubic-bezier(' + p1x + ',' + p1y + ',' +
            p2x + ',' + p2y + ')';
    return output;
};

/**
    Object: O.Easing

    Holds functions emulating the standard CSS easing functions.
*/
var Easing = {
    /**
        Function: O.Easing.cubicBezier

        Returns an easing function that, for the given cubic bezier control
        points, returns the y position given an x position. p0 is presumed to
        be (0,0) and p3 is presumed to be (1,1).

        Parameters:
            p1x - {Number} The x-coordinate for point 1.
            p1y - {Number} The y-coordinate for point 1.
            p2x - {Number} The x-coordinate for point 2.
            p2y - {Number} The y-coordinate for point 2.

        Returns:
            {Function} A function representing the cubic bezier with the points
            given.
    */
    cubicBezier: cubicBezier,

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
    easeInOut: cubicBezier( 0.42, 0, 0.58, 1 ),

    /**
        Function: O.Easing#linear

        Linear easing.

        Parameters:
            n - {Number} A number between 0 and 1 representing the current
                position in the animation.

        Returns:
            {Number} The position along the animation path (between 0 and 1).
    */
    linear: function linear ( n ) {
        return n;
    },
};

Easing.linear.cssName = 'linear';

// List of currently active animations
var animations = [];

// Draw the next frame in all currently active animations.
var nextFrame$1 = function () {
    // Cache to local variable for speed
    var anims = animations;
    var l = anims.length;
    var time = RunLoop.frameStartTime;

    if ( l ) {
        // Request first to get in shortest time.
        RunLoop.invokeInNextFrame( nextFrame$1 );

        while ( l-- ) {
            var objAnimations = anims[l];
            var i = objAnimations.length;
            var hasMultiple = i > 1;
            var object = (void 0);
            if ( hasMultiple ) {
                object = objAnimations[0].object;
                object.beginPropertyChanges();
            }
            while ( i-- ) {
                var animation = objAnimations[i];
                var animTime = animation.startTime;
                // We start the animation clock at the first frame *after* the
                // animation begins. This is becaues there are often a lot of
                // changes happening as well as the animation beginning, and
                // it's better to start the animation a frame later than have
                // a slow first frame and thus stuttery start to the animation
                if ( animTime <= 0 ) {
                    if ( !animTime ) {
                        animation.startTime = -1;
                        continue;
                    }
                    animation.startTime = animTime = time;
                }
                animTime = time - animTime;
                var duration = animation.duration;
                if ( animTime < duration ) {
                    animation.drawFrame(
                        // Normalised position along timeline [0..1].
                        animation.ease( animTime / duration ),
                        // Normalised time animation has been running.
                        animTime,
                        false
                    );
                } else {
                    animation.drawFrame( 1, duration, true );
                    animation.stop();
                }
            }
            if ( hasMultiple ) {
                object.endPropertyChanges();
            }
        }
    }
};

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
var Animation = Class({

    init: function init ( mixin$$1 ) {
        this.isRunning = false;
        this.startTime = 0;

        this.startValue = null;
        this.endValue = null;
        this.deltaValue = null;

        Object.assign( this, mixin$$1 );
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
    ease: Easing.ease,

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
    animate: function animate ( value, duration, ease ) {
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

        var object = this.object;
        var metadata = meta( object );
        var objAnimations = metadata.animations ||
            ( metadata.animations = [] );

        this.startTime = 0;

        // Start loop if no current animations
        if ( !animations.length ) {
            RunLoop.invokeInNextFrame( nextFrame$1 );
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
    prepare: function prepare ( value ) {
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
    drawFrame: function drawFrame ( position, time, isLastFrame ) {
        // And interpolate to find new value.
        var value = isLastFrame ?
            this.endValue :
            this.startValue + ( position * this.deltaValue );

        this.object.set( this.property, value );
    },

    /**
        Method: O.Animation#stop

        Stop the animation (at the current position), if it is in progress.

        Returns:
            {O.Animation} Returns self.
    */
    stop: function stop () {
        if ( this.isRunning ) {
            // Remove from animation lists.
            var object = this.object;
            var objAnimations = meta( object ).animations;
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
    },
});

var setStyle$1 = Element$1.setStyle;

var numbersRe = /[.\-\d]+/g;

var splitTransform = function ( transform ) {
    var result = [];
    var l = transform.length;
    var last = 0;
    var inFn = false;
    var inNumber = false;
    var i, character, part;

    for ( i = 0; i < l; i += 1 ) {
        character = transform.charAt( i );
        if ( ( inNumber || inFn ) &&
                ( inNumber !== /^[.\-\d]/.test( character ) ) ) {
            part = transform.slice( last, i );
            result.push( inNumber ? parseFloat( part ) : part );
            last = i;
            inNumber = !inNumber;
        } else if ( character === '(' ) {
            inFn = true;
        } else if ( character === ')' ) {
            inFn = false;
        }
    }
    result.push( transform.slice( last ) );
    return result;
};

var zeroTransform = function ( parts ) {
    parts = parts.slice();
    for ( var i = 1, l = parts.length; i < l; i += 2 ) {
        parts[i] = 0;
    }
    return parts;
};

var styleAnimators = {
    display: {
        calcDelta: function calcDelta ( startValue, endValue ) {
            return endValue === 'none' ? startValue : endValue;
        },
        calcValue: function calcValue ( position, deltaValue, startValue ) {
            return position ? deltaValue : startValue;
        },
    },
    transform: {
        calcDelta: function calcDelta ( startValue, endValue ) {
            var start = splitTransform( startValue || '' );
            var end = splitTransform( endValue || '' );
            var i, l;
            if ( !endValue || ( endValue === 'none' ) ) {
                end = zeroTransform( start );
            }
            if ( !startValue || ( startValue === 'none' ) ) {
                start = zeroTransform( end );
            }
            if ( start.length !== end.length ) {
                start = [ startValue ];
                end = [ endValue ];
            }
            for ( i = 0, l = start.length; i < l; i += 1 ) {
                if ( start[i] === 0 && /^[,)]/.test( start[ i + 1 ] ) ) {
                    start[ i + 1 ] = end[ i + 1 ].replace( /[,)].*/g, '' ) +
                        start[ i + 1 ];
                }
            }
            return {
                start: start,
                delta: end.map( function ( value, index ) { return (
                    index & 1 ? value - start[ index ] : 0
                ); }),
            };
        },
        calcValue: function calcValue ( position, deltaValue, _, end ) {
            if ( !deltaValue ) {
                return end;
            }
            var start = deltaValue.start;
            var delta = deltaValue.delta;
            var transform = start[0];
            for ( var i = 1, l = start.length; i < l; i += 2 ) {
                transform += start[ i ] + ( position * delta[ i ] );
                transform += start[ i + 1 ];
            }
            return transform;
        },
    },
};

var supported = {
    display: 1,

    top: 1,
    right: 1,
    bottom: 1,
    left: 1,

    marginTop: 1,
    marginRight: 1,
    marginBottom: 1,
    marginLeft: 1,

    paddingTop: 1,
    paddingRight: 1,
    paddingBottom: 1,
    paddingLeft: 1,

    width: 1,
    height: 1,

    transform: 1,

    opacity: 1,
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
    * transform
    * opacity
*/
var StyleAnimation = Class({

    Extends: Animation,

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
    prepare: function prepare ( styles ) {
        var animated = this.animated = [];
        var from = this.startValue = this.current;
        var current = this.current = clone( from );
        var delta = this.deltaValue = {};
        var units = this.units = {};
        var element = this.element;

        this.endValue = styles;

        for ( var property in styles ) {
            var start = from[ property ];
            var end = styles[ property ];
            if ( start !== end ) {
                // We only support animating key layout properties.
                if ( supported[ property ] ) {
                    animated.push( property );
                    var animator = styleAnimators[ property ];
                    if ( animator ) {
                        delta[ property ] = animator.calcDelta( start, end );
                    } else {
                        units[ property ] =
                            ( typeof start === 'string' &&
                                start.replace( numbersRe, '' ) ) ||
                            ( typeof end === 'string' &&
                                end.replace( numbersRe, '' ) ) ||
                            // If no unit specified, using 0 will ensure
                            // the value passed to setStyle is a number, so
                            // it will add 'px' if appropriate.
                            0;
                        start = from[ property ] = parseInt( start, 10 );
                        delta[ property ] = parseInt( end, 10 ) - start;
                    }
                } else {
                    current[ property ] = end;
                    setStyle$1( element, property, end );
                }
            }
        }

        // Animate common top change as a transform for performance
        if ( delta.top && ( !units.top || units.top === 'px' ) ) {
            var transform = styles.transform || '';
            if ( transform === 'none' ) {
                transform = '';
            }
            if ( transform === '' ||
                    /^translate3d\([^,]+,|\d+(?:px)?,0\)$/.test( transform ) ) {
                if ( !delta.transform ) {
                    animated.push( 'transform' );
                }
                if ( transform === '' ) {
                    styles.transform = 'none';
                    transform = 'translate3d(0,' + delta.top +'px,0)';
                } else {
                    var parts = transform.split( ',' );
                    parts[1] = ( parseInt( parts[1], 10 ) + delta.top ) + 'px';
                    transform = parts.join( ',' );
                }
                delta.tt = styleAnimators.transform.calcDelta(
                    from.transform || '',
                    transform
                );
                animated.push( 'tt' );
                animated = animated.filter( function (x) { return x !== 'top' && x !== 'tt'; } );
            }
        }

        if ( animated.length ) {
            setStyle$1( element, 'will-change', animated.join( ', ' ) );
            return true;
        }

        return false;
    },

    /**
        Method (protected): O.StyleAnimation#drawFrame

        Updates the animating styles on the element to the interpolated values
        at the position given.

        Parameters:
            position - {Number} The position in the animation.
    */
    drawFrame: function drawFrame ( position ) {
        var isRunning = position < 1;
        var ref = this;
        var startValue = ref.startValue;
        var endValue = ref.endValue;
        var deltaValue = ref.deltaValue;
        var units = ref.units;
        var current = ref.current;
        var animated = ref.animated;
        var element = ref.element;
        var l = animated.length;

        while ( l-- ) {
            var property = animated[l];
            var delta = deltaValue[ property ];
            var isTopTransform = ( property === 'tt' );
            if ( isTopTransform ) {
                property = 'transform';
            }

            var start = startValue[ property ];
            var end = endValue[ property ];
            var unit = units[ property ];
            var animator = styleAnimators[ property ];
            var value = isRunning ?
                animator ?
                    animator.calcValue( position, delta, start, end ) :
                    ( start + ( position * delta ) ) + unit :
                end;

            if ( isTopTransform ) {
                if ( !isRunning ) {
                    continue;
                }
            } else {
                current[ property ] = value;
                if ( isRunning && deltaValue.tt &&
                        ( property === 'top' || property === 'transform' ) ) {
                    continue;
                }
            }
            setStyle$1( element, property, value );
        }
    },

    stop: function stop () {
        if ( this.isRunning ) {
            var element = this.element;
            if ( this.deltaValue.tt ) {
                var current = this.current;
                setStyle$1( element, 'top', current.top );
                setStyle$1( element, 'transform', current.transform );
            }
            setStyle$1( element, 'will-change', 'auto' );
        }
        return StyleAnimation.parent.stop.call( this );
    },
});

/**
    Mixin: O.AnimatableView

    Mix this into an <O.View> class to automatically animate all changes to the
    view's <O.View#layerStyles> property.
*/
var AnimatableView = {

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
    animateLayerEasing: Easing.ease,

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
    willAnimate: function willAnimate () {
        this.increment( 'animating', 1 );
    },

    /**
        Method: O.AnimatableView#didAnimate

        This method is called by the <O.Animation> class when it finshes
        animating a property on the object. Decrements the <#animating>
        property.
    */
    didAnimate: function didAnimate ( animation ) {
        this.increment( 'animating', -1 );
        if ( !this.get( 'animating' ) && animation instanceof StyleAnimation ) {
            this.parentViewDidResize();
        }
    },

    /**
        Property: O.AnimatableView#layerAnimation
        Type: O.StyleAnimation

        An appropriate animation object (depending on browser support) to
        animate the layer styles. Automatically generated when first accessed.
    */
    layerAnimation: function () {
        return new StyleAnimation({
            object: this,
            element: this.get( 'layer' ),
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
    redrawLayerStyles: function redrawLayerStyles ( layer, oldStyles ) {
        var newStyles = this.get( 'layerStyles' );
        var layerAnimation = this.get( 'layerAnimation' );
        var setStyle = Element$1.setStyle;

        if ( this.get( 'animateLayer' ) && this.get( 'isInDocument' ) ) {
            // Animate
            if ( !layerAnimation.current ) {
                layerAnimation.current = oldStyles || newStyles;
            }
            layerAnimation.animate(
                newStyles,
                this.get( 'animateLayerDuration' ),
                this.get( 'animateLayerEasing' )
            );
            if ( !layerAnimation.isRunning ) {
                this.willAnimate( layerAnimation );
                this.didAnimate( layerAnimation );
            }
        } else {
            // Or just set.
            layerAnimation.stop();
            layerAnimation.current = newStyles;
            for ( var property in newStyles ) {
                var value = newStyles[ property ];
                if ( value !== oldStyles[ property ] ) {
                    setStyle( layer, property, value );
                }
            }
            this.parentViewDidResize();
        }
        // Just remove styles that are not specified in the new styles, but were
        // in the old styles
        for ( var property$1 in oldStyles ) {
            if ( !( property$1 in newStyles ) ) {
                setStyle( layer, property$1, null );
            }
        }
    },
};

var isMac = UA.isMac;
var platformKeys = {
    Alt: isMac ? '⌥' : 'Alt-',
    Cmd: isMac ? '⌘' : 'Ctrl-',
    Meta: isMac ? '⌘' : 'Meta-',
    Shift: isMac ? '⇧' : 'Shift-',
    Escape: 'Esc',
    Enter: isMac ? '↵' : 'Enter',
    Backspace: isMac ? '⌫' : 'Backspace',
};

/**
    Function: O.formatKeyForPlatform

    Parameters:
        shortcut - {String} The keyboard shorcut, in the same format as
                   taken by <O.GlobalKeyboardShortcuts#register>.

    Returns:
        {String} The shortcut formatted for display on the user's platform.
*/
function formatKeyForPlatform ( shortcut ) {
    return shortcut.split( '-' ).map(
        function (key) { return platformKeys[ key ] || key.capitalise(); }
    ).join( '' );
}

/**
    Namespace: O.DOMEvent

    O.DOMEvent contains functions for use with DOM event objects
*/

/**
    Property: O.DOMEvent.keys
    Type: Object

    Maps the names of special keys to their key code.
*/
var keys = {
    8: 'Backspace',
    9: 'Tab',
    13: 'Enter',
    16: 'Shift',
    17: 'Control',
    18: 'Alt',
    20: 'CapsLock',
    27: 'Escape',
    32: 'Space',
    33: 'PageUp',
    34: 'PageDown',
    35: 'End',
    36: 'Home',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
    46: 'Delete',
    144: 'NumLock',
};

var keyReplacements = {
    // For our own convenience
    ' ': 'Space',

    // For some older browsers (specifically, Firefox < 37)
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',

    // For iOS Safari/WKWebView, to work around
    // https://bugreport.apple.com/web/?problemID=37144181
    UIKeyInputEscape: 'Escape',
    UIKeyInputLeftArrow: 'ArrowLeft',
    UIKeyInputRightArrow: 'ArrowRight',
    UIKeyInputUpArrow: 'ArrowUp',
    UIKeyInputDownArrow: 'ArrowDown',
};

/**
    Function: O.DOMEvent.lookupKey

    Determines which key was pressed to generate the event supplied as an
    argument.

    Parameters:
        event       - {KeyEvent} The W3C DOM event object.
        noModifiers - Unless true, Alt-/Ctrl-/Meta-/Shift- will be prepended
                      to the returned value if the respective keys are held
                      down. They will always be in alphabetical order, e.g.
                      If the user pressed 'g' whilst holding down Shift and
                      Alt, the return value would be 'Alt-Shift-g'.

    Returns:
        {String} The key pressed (in lowercase if a letter).
*/
var lookupKey = function ( event, noModifiers ) {
    var isKeyPress = ( event.type === 'keypress' );
    // Newer browser api
    var key = event.key;
    if ( !key ) {
        // See http://unixpapa.com/js/key.html. Short summary:
        // event.keyCode || event.which gives the ASCII code for any normal
        // keypress on all browsers. However, if event.which === 0 then it was a
        // special key and so it should be looked up in the table of function
        // keys. Anything from code 32 downwards must also be a special char.
        var code = event.keyCode || event.which;
        var preferAsci = isKeyPress && code > 32 &&
                event.which !== 0 && event.charCode !== 0;
        var str = String.fromCharCode( code ).toLowerCase();
        key = ( !preferAsci && keys[ code ] ) || str;

        // Function keys
        if ( !preferAsci && 111 < code && code < 124 ) {
            key = 'F' + ( code - 111 );
        }
    } else {
        key = keyReplacements[ key ] || key;
    }

    // Append modifiers (use alphabetical order)
    var modifiers = '';
    if ( !noModifiers ) {
        // Different keyboard layouts may require Shift/Alt for non A-Z
        // keys, so we only add meta and ctrl modifiers.
        var altAndShift = !isKeyPress || ( /[a-z]/.test( key ) );
        if ( event.altKey && altAndShift ) {
            modifiers += 'Alt-';
        }
        if ( event.ctrlKey ) {
            modifiers += 'Ctrl-';
        }
        if ( event.metaKey ) {
            modifiers += 'Meta-';
        }
        if ( event.shiftKey && altAndShift ) {
            modifiers += 'Shift-';
        }
    }

    return modifiers + key;
};

/**
    Function: O.DOMEvent.isClickModified

    Determines if a secondary mouse button was pressed, or a modifier key
    was held down while the mouse was clicked.

    Parameters:
        event - {MouseEvent} The W3C DOM click event object.

    Returns:
        {Boolean} Was a secondary button clicked or modifier held down?
*/
var isClickModified = function ( event ) {
    return !!event.button ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
};




var DOMEvent = Object.freeze({
    keys: keys,
    lookupKey: lookupKey,
    isClickModified: isClickModified
});

/**
    Enum: O.DragEffect

    NONE    - No effect when drag released.
    COPY    - Data will be copied to target.
    MOVE    - Data will be moved to target.
    LINK    - Data will be linked to by target.
    ALL     - Data may be copied, moved or linked by target.
    DEFAULT - The default browser action when released.
*/
var NONE = 0;
var COPY = 1;
var MOVE = 2;
var LINK = 4;
var ALL = 1|2|4;
var DEFAULT = 8;

/**
    Property: O.DragEffect.effectToString
    Type: String[]

    Maps bit mask effect to string
*/
var effectToString = [
    'none',
    'copy',
    'move',
    'copyMove',
    'link',
    'copyLink',
    'linkMove',
    'all',
    '' ];


var DragEffect = Object.freeze({
    NONE: NONE,
    COPY: COPY,
    MOVE: MOVE,
    LINK: LINK,
    ALL: ALL,
    DEFAULT: DEFAULT,
    effectToString: effectToString
});

/**
    Mixin: O.DropTarget

    The DropTarget mixin should be applied to views you wish to make drop
    targets.
*/
var DropTarget = {
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
    dropEffect: MOVE,

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
    willAcceptDrag: function willAcceptDrag ( drag ) {
        var acceptedTypes = this.get( 'dropAcceptedDataTypes' );
        var availableTypes = drag.get( 'dataTypes' );
        var l = availableTypes.length;
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
    dropEntered: function dropEntered ( drag ) {
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
    dropMoved: function dropMoved (/* drag */) {},

    /**
        Method: O.DropTarget#dropExited

        Called when a drag instance exits the view.

        Resets the drop effect on the drag instance and updates the hasDragOver
        property.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dropExited: function dropExited ( drag ) {
        drag.set( 'dropEffect', DEFAULT );
        this.set( 'hasDragOver', false );
    },

    /**
        Method: O.DropTarget#drop

        Called when a drag instance is dropped on the view.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    drop: function drop (/* drag */) {},
};

/*global document */

var GestureManager = new Obj({

    _gestures: [],

    register: function register ( gesture ) {
        this._gestures.push( gesture );
    },

    deregister: function deregister ( gesture ) {
        this._gestures.erase( gesture );
    },

    isMouseDown: false,

    fire: function fire ( type, event ) {
        if ( /^touch/.test( type ) ) {
            var gestures = this._gestures;
            var l = gestures.length;
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
        event.propagationStopped = false;
    },
});

ViewEventsController.addEventTarget( GestureManager, 30 );

var Gesture = Class({
    init: function init ( mixin$$1 ) {
        Object.assign( this, mixin$$1 );
        GestureManager.register( this );
    },
    destroy: function destroy () {
        GestureManager.deregister( this );
    },
    cancel: function cancel () {},
    start: function start () {},
    move: function move () {},
    end: function end () {},
});

/*  We can't just call preventDefault on touch(start|move), as this would
    prevent scrolling and also prevent links we want to act as normal from
    working. So we use this hack instead to capture the subsequent click and
    remove it from the app's existence.
*/
var MouseEventRemover = Class({
    init: function init ( target, defaultPrevented ) {
        this.target = target;
        this.stop = defaultPrevented;
        this.time = Date.now();
        ViewEventsController.addEventTarget( this, 40 );
    },
    fire: function fire ( type, event ) {
        var isClick = ( type === 'click' ) && !event.originalType;
        var isMouse = isClick || /^mouse/.test( type );
        if ( type === 'touchstart' || Date.now() - this.time > 1000 ) {
            ViewEventsController.removeEventTarget( this );
            isMouse = false;
        }
        if ( isMouse && ( this.stop || event.target !== this.target ) ) {
            event.preventDefault();
        }
        event.propagationStopped = isMouse;
    },
});

var TapEvent = Class({

    Extends: Event,

    originalType: 'tap',
});

var TrackedTouch = function TrackedTouch ( x, y, time, target ) {
    this.x = x;
    this.y = y;
    this.time = time;
    var activeEls = this.activeEls = [];
    do {
        if ( /^(?:A|BUTTON|INPUT|LABEL)$/.test( target.nodeName ) ) {
            activeEls.push( target );
            target.classList.add( 'tap-active' );
        }
    } while ( target = target.parentNode );
};

TrackedTouch.prototype.done = function done () {
    var activeEls = this.activeEls;
    var l = activeEls.length;
    for ( var i = 0; i < l; i += 1 ) {
        activeEls[i].classList.remove( 'tap-active' );
    }
};

var isInputOrLink = function ( node ) {
    var nodeName = node.nodeName;
    var seenLink = false;
    if ( nodeName === 'INPUT' ||
        nodeName === 'BUTTON' ||
        nodeName === 'TEXTAREA' ||
        nodeName === 'SELECT' ) {
        return true;
    }
    while ( node && node.contentEditable === 'inherit' ) {
        if ( node.nodeName === 'A' ) {
            seenLink = true;
        }
        node = node.parentNode;
    }
    if ( node && node.contentEditable === 'true' ) {
        return true;
    }
    while ( !seenLink && node ) {
        if ( node.nodeName === 'A' ) {
            seenLink = true;
        }
        node = node.parentNode;
    }
    return seenLink;
};

/*  A tap is defined as a touch which:

    * Lasts less than 200ms.
    * Moves less than 5px from the initial touch point.

    There may be other touches occurring at the same time (e.g. you could be
    holding one button and tap another; the tap gesture will still be
    recognised).
*/
var Tap = new Gesture({

    _tracking: {},

    cancel: function cancel () {
        var tracking = this._tracking;
        for ( var id in tracking ) {
            tracking[ id ].done();
        }
        this._tracking = {};
    },

    start: function start ( event ) {
        var touches = event.changedTouches;
        var tracking = this._tracking;
        var now = Date.now();
        var l = touches.length;
        for ( var i = 0; i < l; i += 1 ) {
            var touch = touches[i];
            var id = touch.identifier;
            if ( !tracking[ id ] ) {
                tracking[ id ] = new TrackedTouch(
                    touch.screenX, touch.screenY, now, touch.target );
            }
        }
    },

    move: function move ( event ) {
        var touches = event.changedTouches;
        var tracking = this._tracking;
        var l = touches.length;
        for ( var i = 0; i < l; i += 1 ) {
            var touch = touches[i];
            var id = touch.identifier;
            var trackedTouch = tracking[ id ];
            if ( trackedTouch ) {
                var deltaX = touch.screenX - trackedTouch.x;
                var deltaY = touch.screenY - trackedTouch.y;
                if ( deltaX * deltaX + deltaY * deltaY > 25 ) {
                    trackedTouch.done();
                    delete tracking[ id ];
                }
            }
        }
    },

    end: function end ( event ) {
        var touches = event.changedTouches;
        var tracking = this._tracking;
        var now = Date.now();
        var l = touches.length;
        for ( var i = 0; i < l; i += 1 ) {
            var touch = touches[i];
            var id = touch.identifier;
            var trackedTouch = tracking[ id ];
            if ( trackedTouch ) {
                if ( now - trackedTouch.time < 200 ) {
                    var target = touch.target;
                    var tapEvent = new TapEvent( 'tap', target );
                    ViewEventsController.handleEvent( tapEvent );
                    var clickEvent = new TapEvent( 'click', target );
                    clickEvent.defaultPrevented = tapEvent.defaultPrevented;
                    ViewEventsController.handleEvent( clickEvent );
                    // The tap could trigger a UI change. When the click event
                    // is fired 300ms later, if there is now an input under the
                    // area the touch took place, in iOS the keyboard will
                    // appear, even though the preventDefault on the click event
                    // stops it actually being focused. Calling preventDefault
                    // on the touchend event stops this happening, however we
                    // must not do this if the user actually taps an input or
                    // a link!
                    if ( !isInputOrLink( target ) ) {
                        event.preventDefault();
                    }
                    new MouseEventRemover(
                        target, clickEvent.defaultPrevented );
                }
                trackedTouch.done();
                delete tracking[ id ];
            }
        }
    },
});

/**
    Class: O.AbstractControlView

    Extends: O.View

    The superclass for most DOM-control view classes. This is an abstract class
    and should not be instantiated directly; it is only intended to be
    subclassed.
*/
var AbstractControlView = Class({

    Extends: View,

    /**
        Property: O.AbstractControlView#isDisabled
        Type: Boolean
        Default: false

        Is the control disabled?
    */
    isDisabled: false,

    /**
        Property: O.AbstractControlView#isFocused
        Type: Boolean

        Represents whether the control currently has focus or not.
    */
    isFocused: false,

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
            loc( 'Shortcut: [_1]',
                shortcut
                    .split( ' ' )
                    .map( formatKeyForPlatform )
                    .join( ' ' + loc( 'or' ) + ' ' )
            ) : '';
    }.property( 'shortcut' ),

    /**
        Method: O.AbstractControlView#didEnterDocument

        Overridden to add keyboard shortcuts.
        See <O.View#didEnterDocument>.
    */
    didEnterDocument: function didEnterDocument () {
        var this$1 = this;

        AbstractControlView.parent.didEnterDocument.call( this );
        var shortcut = this.get( 'shortcut' );
        if ( shortcut ) {
            shortcut.split( ' ' ).forEach( function (key) {
                ViewEventsController.kbShortcuts
                    .register( key, this$1, 'activate' );
            });
        }
        return this;
    },

    /**
        Method: O.AbstractControlView#didEnterDocument

        Overridden to remove keyboard shortcuts.
        See <O.View#didEnterDocument>.
    */
    willLeaveDocument: function willLeaveDocument () {
        var this$1 = this;

        var shortcut = this.get( 'shortcut' );
        if ( shortcut ) {
            shortcut.split( ' ' ).forEach( function (key) {
                ViewEventsController.kbShortcuts
                    .deregister( key, this$1, 'activate' );
            });
        }
        // iOS is very buggy if you remove a focused control from the doc;
        // the picker/keyboard stays up and cannot be dismissed
        if ( UA.isIOS && this.get( 'isFocused' ) ) {
            this.blur();
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
    draw: function draw ( layer, Element, el ) {
        var control = this._domControl;
        var name = this.get( 'name' );
        var shortcut = this.get( 'shortcut' );
        var tabIndex = this.get( 'tabIndex' );

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

        if ( shortcut && /^\w$/.test( shortcut ) ) {
            control.accessKey = shortcut;
        }

        layer.title = this.get( 'tooltip' );
        return this._domLabel = el( 'span.label', [ this.get( 'label' ) ] );
    },

    // --- Keep render in sync with state ---

    abstractControlNeedsRedraw: function ( self, property, oldValue ) {
        return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes(
        'isDisabled', 'label', 'name', 'tooltip', 'tabIndex', 'shortcut' ),

    /**
        Method: O.AbstractControlView#redrawIsDisabled

        Updates the disabled attribute on the DOM control to match the
        isDisabled property of the view.
    */
    redrawIsDisabled: function redrawIsDisabled () {
        this._domControl.disabled = this.get( 'isDisabled' );
    },

    /**
        Method: O.AbstractControlView#redrawLabel

        Updates the DOM label to match the label property of the view.
    */
    redrawLabel: function redrawLabel () {
        var label = this._domLabel;
        var child;
        while ( child = label.firstChild ) {
            label.removeChild( child );
        }
        Element$1.appendChildren( label, [
            this.get( 'label' ) ]);
    },

    /**
        Method: O.AbstractControlView#redrawName

        Updates the name attribute on the DOM control to match the name
        property of the view.
    */
    redrawName: function redrawName () {
        this._domControl.name = this.get( 'name' );
    },

    /**
        Method: O.AbstractControlView#redrawTooltip

        Parameters:
            layer - {Element} The DOM layer for the view.

        Updates the title attribute on the DOM layer to match the tooltip
        property of the view.
    */
    redrawTooltip: function redrawTooltip ( layer ) {
        layer.title = this.get( 'tooltip' );
    },

    /**
        Method: O.AbstractControlView#redrawTabIndex

        Updates the tabIndex attribute on the DOM control to match the tabIndex
        property of the view.
    */
    redrawTabIndex: function redrawTabIndex () {
        this._domControl.tabIndex = this.get( 'tabIndex' );
    },

    redrawShortcut: function redrawShortcut () {
        var shortcut = this.get( 'shortcut' );
        if ( shortcut && !/^\w$/.test( shortcut ) ) {
            shortcut = '';
        }
        this._domControl.accessKey = shortcut;
    },

    // --- Focus ---

    /**
        Method: O.AbstractControlView#focus

        Focusses the control.

        Returns:
            {O.AbstractControlView} Returns self.
    */
    focus: function focus () {
        if ( this.get( 'isInDocument' ) ) {
            this._domControl.focus();
            // Fire event synchronously.
            if ( !this.get( 'isFocused' ) ) {
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
    blur: function blur () {
        if ( this.get( 'isInDocument' ) ) {
            this._domControl.blur();
            // Fire event synchronously.
            if ( this.get( 'isFocused' ) ) {
                this.fire( 'blur' );
            }
        }
        return this;
    },

    /**
        Method (private): O.AbstractControlView#_updateIsFocused

        Updates the <#isFocused> property.

        Parameters:
            event - {Event} The focus event.
    */
    _updateIsFocused: function ( event ) {
        this.set( 'isFocused', event.type === 'focus' );
    }.on( 'focus', 'blur' ),

    // --- Activate ---

    /**
        Method: O.AbstractControlView#activate

        An abstract method to be overridden by subclasses. This is the action
        performed when the control is activated, either by being clicked on or
        via a keyboard shortcut.
    */
    activate: function activate () {},

});

var passiveSupported = false;

try {
    var options = Object.defineProperty( {}, 'passive', {
        get: function get () {
            passiveSupported = true;
        },
    });
    window.addEventListener( 'test', options, options);
    window.removeEventListener( 'test', options, options);
} catch ( error ) {
    passiveSupported = false;
}

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
var RootView = Class({

    Extends: View,

    syncOnlyInDocument: false,

    layer: null,

    init: function init ( node /*, ...mixins */) {
        var this$1 = this;

        RootView.parent.constructor.apply( this,
            Array.prototype.slice.call( arguments, 1 ) );

        // Node.DOCUMENT_NODE => 9.
        var nodeIsDocument = ( node.nodeType === 9 );
        var doc = nodeIsDocument ? node : node.ownerDocument;
        var win = doc.defaultView;
        var events, l;

        events = [
            'click', 'mousedown', 'mouseup', 'dblclick',
            'keypress', 'keydown', 'keyup',
            'dragstart',
            'touchstart', 'touchmove', 'touchend', 'touchcancel',
            'wheel',
            'cut',
            'submit' ];
        for ( l = events.length; l--; ) {
            node.addEventListener( events[l], this$1, passiveSupported ? {
                passive: false,
            } : false );
        }
        // These events don't bubble: have to capture.
        // In IE, we use a version of focus and blur which will bubble, but
        // there's no way of bubbling/capturing change and input.
        // These events are automatically added to all inputs when created
        // instead.
        events = [ 'focus', 'blur', 'change', 'input' ];
        for ( l = events.length; l--; ) {
            node.addEventListener( events[l], this$1, true );
        }
        events = [ 'resize', 'scroll' ];
        for ( l = events.length; l--; ) {
            win.addEventListener( events[l], this$1, false );
        }

        this.isRendered = true;
        this.isInDocument = true;
        this.layer = nodeIsDocument ? node.body : node;
    },

    safeAreaInsetBottom: 0,

    _onScroll: function ( event ) {
        var layer = this.get( 'layer' );
        var isBody = ( layer.nodeName === 'BODY' );
        var doc = layer.ownerDocument;
        var win = doc.defaultView;
        var left = isBody ? win.pageXOffset : layer.scrollLeft;
        var top = isBody ? win.pageYOffset : layer.scrollTop;
        this.beginPropertyChanges()
                .set( 'scrollLeft', left )
                .set( 'scrollTop', top )
            .endPropertyChanges();
        event.stopPropagation();
    }.on( 'scroll' ),

    preventRootScroll: UA.isIOS ? function ( event ) {
        var view = event.targetView;
        var doc, win;
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

    focus: function focus () {
        var layer = this.get( 'layer' );
        var activeElement = layer.ownerDocument.activeElement;
        var view = getViewFromNode( activeElement );
        if ( view instanceof AbstractControlView ) {
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
        case 'resize':
            this.didResize();
            return;
        // Scroll events are special.
        case 'scroll':
            this._onScroll( event );
            return;
        }
        ViewEventsController.handleEvent( event, null, this );
    }.invokeInRunLoop(),
});

var el = Element$1.create;
var setStyle$2 = Element$1.setStyle;

var ScrollAnimation = Class({

    Extends: Animation,

    duration: 250,

    prepare: function prepare ( coordinates ) {
        var object = this.object;
        var startX = this.startX = object.get( 'scrollLeft' );
        var startY = this.startY = object.get( 'scrollTop' );
        var endX = this.endX = coordinates.x || 0;
        var endY = this.endY = coordinates.y || 0;
        var deltaX = this.deltaX = endX - startX;
        var deltaY = this.deltaY = endY - startY;

        setStyle$2( object.get( 'layer' ), 'will-change', 'scroll-position' );

        return !!( deltaX || deltaY );
    },

    drawFrame: function drawFrame ( position ) {
        var isRunning = position < 1;
        var object = this.object;
        var x = isRunning ?
                this.startX + ( position * this.deltaX ) : this.endX;
        var y = isRunning ?
                this.startY + ( position * this.deltaY ) : this.endY;
        object._scrollTo( x, y );
        if ( !isRunning ) {
            setStyle$2( object.get( 'layer' ), 'will-change', 'auto' );
        }
    },
});

/**
    Class: O.ScrollView

    Extends: O.View

    An O.ScrollView instance is a fixed size container, which can be scrolled if
    its contents overflows the bounds of the view. By default, a scrollbar will
    only be shown for vertical overflow. Set the <O.ScrollView#showScrollbarX>
    property to `true` to show a scrollbar on horizontal overflow as well.
*/
var ScrollView = Class({

    Extends: View,

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
    layout: View.LAYOUT_FILL_PARENT,

    /**
        Property: O.ScrollView#layerStyles
        Type: Object

        Sets the overflow styles to show the scrollbars.
    */
    layerStyles: function () {
        var styles = View.prototype.layerStyles.call( this );
        styles.overflowX = this.get( 'showScrollbarX' ) ? 'auto' : 'hidden';
        styles.overflowY = this.get( 'showScrollbarY' ) ? 'auto' : 'hidden';
        styles.WebkitOverflowScrolling = 'touch';
        return styles;
    }.property( 'layout', 'positioning', 'showScrollbarX', 'showScrollbarY' ),

    isFixedDimensions: function () {
        var positioning = this.get( 'positioning' );
        return positioning === 'absolute' || positioning === 'fixed';
    }.property( 'positioning' ),

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
                'PageDown': 'scrollPage',
                'PageUp': 'reverseScrollPage',
                'Space': 'scrollPage',
                'Shift-Space': 'reverseScrollPage',
                'ArrowDown': 'scrollLine',
                'ArrowUp': 'reverseScrollLine'
            }
    */
    keys: {},

    didCreateLayer: function didCreateLayer ( layer ) {
        layer.tabIndex = -1;
    },

    willEnterDocument: function willEnterDocument () {
        ScrollView.parent.willEnterDocument.call( this );
        if ( this.get( 'isFixedDimensions' ) ) {
            var scrollContents = this._scrollContents || this.get( 'layer' );
            scrollContents.appendChild(
                this._safeAreaPadding = el( 'div.v-Scroll-safeAreaPadding' )
            );
            this.getParent( RootView ).addObserverForKey(
                'safeAreaInsetBottom', this, 'redrawSafeArea' );
            this.redrawSafeArea();
        }
        return this;
    },

    didEnterDocument: function didEnterDocument () {
        var this$1 = this;

        this.get( 'layer' ).addEventListener( 'scroll', this, false );

        // Add keyboard shortcuts:
        var keys = this.get( 'keys' );
        var shortcuts = ViewEventsController.kbShortcuts;
        for ( var key in keys ) {
            shortcuts.register( key, this$1, keys[ key ] );
        }

        return ScrollView.parent.didEnterDocument.call( this );
    },

    willLeaveDocument: function willLeaveDocument () {
        var this$1 = this;

        // Remove keyboard shortcuts:
        var keys = this.get( 'keys' );
        var shortcuts = ViewEventsController.kbShortcuts;
        for ( var key in keys ) {
            shortcuts.deregister( key, this$1, keys[ key ] );
        }

        this.get( 'layer' ).removeEventListener( 'scroll', this, false );

        return ScrollView.parent.willLeaveDocument.call( this );
    },

    didLeaveDocument: function didLeaveDocument () {
        var safeAreaPadding = this._safeAreaPadding;
        if ( safeAreaPadding ) {
            this.getParent( RootView ).removeObserverForKey(
                'safeAreaInsetBottom', this, 'redrawSafeArea' );
            safeAreaPadding.parentNode.removeChild( safeAreaPadding );
            this._safeAreaPadding = null;
        }
        return ScrollView.parent.didLeaveDocument.call( this );
    },

    insertView: function insertView ( view, relativeTo, where ) {
        var safeAreaPadding = this._safeAreaPadding;
        if ( !relativeTo && safeAreaPadding &&
                ( !where || where === 'bottom' ) ) {
            relativeTo = safeAreaPadding;
            where = 'before';
        }
        return ScrollView.parent.insertView.call(
            this, view, relativeTo, where );
    },

    redrawSafeArea: function redrawSafeArea () {
        this._safeAreaPadding.style.height =
            this.getParent( RootView ).get( 'safeAreaInsetBottom' ) + 'px';
    },

    // ---

    _restoreScroll: function () {
        // Scroll is reset to 0 in some browsers whenever it is removed from the
        // DOM, so we need to set it to what it should be.
        if ( this.get( 'isInDocument' ) ) {
            var layer = this.get( 'layer' );
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
            object: this,
        });
    }.property(),

    /**
        Property: O.ScrollView#isAnimating
        Type: Boolean

        Is the scroll currently animating?
    */
    isAnimating: false,

    willAnimate: function willAnimate () {
        this.set( 'isAnimating', true );
    },

    didAnimate: function didAnimate () {
        this.set( 'isAnimating', false );
    },

    /**
        Method: O.ScrollView#scrollToTop

        Scrolls the view to the top
    */
    scrollToTop: function scrollToTop () {
        return this.scrollTo( 0, 0, true );
    },

    /**
        Method: O.ScrollView#scrollToBottom

        Scrolls the view to the bottom
    */
    scrollToBottom: function scrollToBottom () {
        return this.scrollTo( 0,
            this.get( 'layer' ).scrollHeight - this.get( 'pxHeight' ),
            true
        );
    },

    /**
        Method: O.ScrollView#scrollPage

        Scrolls the view down by the view height - 50px.
    */
    scrollPage: function scrollPage () {
        return this.scrollBy( 0, this.get( 'pxHeight' ) - 50, true );
    },

    /**
        Method: O.ScrollView#reverseScrollPage

        Scrolls the view up by the view height - 50px.
    */
    reverseScrollPage: function reverseScrollPage () {
        return this.scrollBy( 0, 50 - this.get( 'pxHeight' ), true );
    },

    /**
        Method: O.ScrollView#scrollLine

        Scrolls the view down by 40px.
    */
    scrollLine: function scrollLine () {
        return this.scrollBy( 0, 40 );
    },

    /**
        Method: O.ScrollView#reverseScrollLine

        Scrolls the view up by 40px.
    */
    reverseScrollLine: function reverseScrollLine () {
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
    scrollBy: function scrollBy ( x, y, withAnimation ) {
        var left = this.get( 'scrollLeft' );
        var top = this.get( 'scrollTop' );
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
    scrollToView: function scrollToView ( view, offset, withAnimation ) {
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
    scrollTo: function scrollTo ( x, y, withAnimation ) {
        // Can't have negative scroll values.
        // Can't scroll to fractional positions
        x = x < 0 ? 0 : Math.round( x );
        y = y < 0 ? 0 : Math.round( y );

        var scrollAnimation = this.get( 'scrollAnimation' );
        scrollAnimation.stop();

        if ( withAnimation && this.get( 'isInDocument' ) ) {
            scrollAnimation.animate({
                x: x,
                y: y,
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
    _scrollTo: function _scrollTo ( x, y ) {
        this.set( 'scrollLeft', x )
            .set( 'scrollTop', y );
        this.redrawScroll();
    },

    /**
        Method: O.ScrollView#redrawScroll

        Redraws the scroll position in the layer to match the view's state.
    */
    redrawScroll: function redrawScroll () {
        var layer = this.get( 'layer' );
        var x = this.get( 'scrollLeft' );
        var y = this.get( 'scrollTop' );
        layer.scrollLeft = x;
        layer.scrollTop = y;
        // In case we've gone past the end.
        if ( x || y ) {
            RunLoop.queueFn( 'after', this.syncBackScroll, this );
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
        var layer = this.get( 'layer' );
        var x = layer.scrollLeft;
        var y = layer.scrollTop;
        this.beginPropertyChanges()
            .set( 'scrollLeft', x )
            .set( 'scrollTop', y )
            .endPropertyChanges();
        if ( event ) {
            event.stopPropagation();
            // Don't interpret tap to stop scroll as a real tap.
            Tap.cancel();
        }
    }.on( 'scroll' ),

    // ---

    /**
        Method: O.ScrollView#focus

        Focuses the scrollable element. This will mean default browser shortcuts
        will work for scrolling (e.g. up/down/space etc.).

        Returns:
            {O.ScrollView} Returns self.
    */
    focus: function focus () {
        this.get( 'layer' ).focus();
        return this;
    },
});

if ( UA.isIOS ) {
    Object.assign( ScrollView.prototype, {
        draw: function draw ( layer, Element, el ) {
            var isFixedDimensions = this.get( 'isFixedDimensions' );
            var scrollFixerHeight = 1;

            // Render the children.
            var children = ScrollView.parent.draw.call( this,
                layer, Element, el );

            // Following platform conventions, we assume a fixed height
            // ScrollView should always scroll, regardless of whether the
            // content is taller than the view, whereas a variable height
            // ScrollView just needs to scroll if the content requires it.
            // Therefore, if it's a fixed height view, we add an extra
            // invisible div permanently 1px below the height, so it always
            // has scrollable content.
            // From iOS 11, if not in Safari, it appears that the view will
            // always be scrollable as long as the content is at longer; you
            // don't need to ensure you are not at the very top
            if ( isFixedDimensions && ( UA.version < 11 || UA.safari ) ) {
                scrollFixerHeight = 2;
                layer.appendChild(
                    el( 'div', { style: 'height:1px' } )
                );
            }

            // Append the actual children of the scroll view.
            Element.appendChildren( layer, children );

            if ( isFixedDimensions ) {
                layer.appendChild(
                    el( 'div', {
                        style: 'position:absolute;top:100%;left:0px;' +
                            'width:1px;height:' + scrollFixerHeight + 'px;',
                    })
                );
                this.on( 'scroll', this, '_setNotAtEnd' )
                    .addObserverForKey( 'isInDocument', this, '_setNotAtEnd' );
            }
        },

        _setNotAtEnd: function () {
            if ( this.get( 'isInDocument' ) ) {
                var scrollTop = this.get( 'scrollTop' );
                var scrollLeft = this.get( 'scrollLeft' );
                if ( !scrollTop && ( UA.version < 11 || UA.safari ) ) {
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

        insertView: function insertView ( view, relativeTo, where ) {
            var safeAreaPadding = this._safeAreaPadding;
            if ( !relativeTo && safeAreaPadding ) {
                relativeTo = this.get( 'layer' );
                if ( where === 'top' ) {
                    relativeTo = relativeTo.firstChild;
                    where = 'after';
                } else if ( !where || where === 'bottom' ) {
                    relativeTo = this.get( 'isFixedDimensions' ) ?
                        safeAreaPadding.previousSibling :
                        safeAreaPadding;
                    where = 'before';
                }
            }
            return ScrollView.parent.insertView.call(
                this, view, relativeTo, where );
        },
    });
}

var inView = function ( view, event ) {
    var targetView = event.targetView;
    while ( targetView && targetView !== view ) {
        targetView = targetView.get( 'parentView' );
    }
    return !!targetView;
};

var ModalEventHandler = Class({

    Extends: Obj,

    init: function init (/* ...mixins */) {
        ModalEventHandler.parent.constructor.apply( this, arguments );
        this._seenMouseDown = false;
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
    // interaction, but these must not hide the view. Therefore, we make sure
    // we've seen at least one mousedown event after the popOver view shows
    // before hiding on click. On Android/iOS, we will not see a mousedown
    // event, so we also count a touchstart event.
    handleMouse: function ( event ) {
        var view = this.get( 'view' );
        var type = event.type;
        if ( !event.seenByModal && !inView( view, event ) ) {
            event.stopPropagation();
            if ( type === 'mousedown' ) {
                this._seenMouseDown = true;
            } else if ( type === 'click' ) {
                event.preventDefault();
                if ( this._seenMouseDown ) {
                    if ( view.clickedOutside ) {
                        view.clickedOutside( event );
                    }
                }
            } else if ( type === 'wheel' ) {
                var scrollView = this.get( 'view' ).getParent( ScrollView );
                if ( !scrollView || !inView( scrollView, event ) ) {
                    event.preventDefault();
                }
            }
        }
        event.seenByModal = true;
    }.on( 'click', 'mousedown', 'mouseup', 'tap', 'wheel' ),

    // If the user clicks on a scroll bar to scroll (I know, who does that
    // these days right?), we don't want to count that as a click. So cancel
    // the seen mousedown on scroll events.
    handleScroll: function () {
        this._seenMouseDown = false;
    }.on( 'scroll' ),

    handleKeys: function ( event ) {
        var view = this.get( 'view' );
        if ( !event.seenByModal && !inView( view, event ) ) {
            event.stopPropagation();
            // View may be interested in key events:
            if ( view.keyOutside ) {
                view.keyOutside( event );
            }
        }
        event.seenByModal = true;
    }.on( 'keypress', 'keydown', 'keyup' ),

    handleTouch: function ( event ) {
        var view = this.get( 'view' );
        if ( !event.seenByModal && !inView( view, event ) ) {
            event.preventDefault();
            event.stopPropagation();
            // Clicks outside should now close the modal.
            this._seenMouseDown = true;
        }
        event.seenByModal = true;
    }.on( 'touchstart' ),
});

var PopOverView = Class({

    Extends: View,

    init: function init () {
        this.parentPopOverView = null;
        this.isVisible = false;
        this.options = {};
        this._inResize = false;
        PopOverView.parent.init.apply( this, arguments );
    },

    className: function () {
        var options = this.get( 'options' );
        var positionToThe = options && options.positionToThe || 'bottom';
        var alignEdge = options && options.alignEdge || 'left';
        return 'v-PopOverContainer' +
            ' v-PopOverContainer--p' + positionToThe.charAt( 0 ) +
            ' v-PopOverContainer--a' + alignEdge.charAt( 0 );
    }.property( 'options' ),

    positioning: 'absolute',

    ariaAttributes: {
        modal: 'true',
    },

    draw: function draw ( layer, Element, el ) {
        var children = [
            this._aFlex = el( 'div' ),
            this._popOver = el( 'div.v-PopOver', [
                this._callout = el( 'b.v-PopOver-callout', [
                    el( 'b.v-PopOver-triangle' ) ]) ]),
            this._bFlex = el( 'div' ) ];
        this.redrawLayer();
        return children;
    },

    redrawLayer: function redrawLayer () {
        var options = this.get( 'options' );
        if ( !options ) {
            return;
        }
        var alignWithView = options.alignWithView;
        var atNode = options.atNode ||
            ( alignWithView === this.get( 'parentPopOverView' ) ?
                alignWithView._popOver : alignWithView.get( 'layer' ) );
        var positionToThe = options.positionToThe || 'bottom';
        var positionToTheLeftOrRight =
            positionToThe === 'left' || positionToThe === 'right';
        var alignEdge = options.alignEdge || 'left';
        var offsetTop = options.offsetTop || 0;
        var offsetLeft = options.offsetLeft || 0;
        var rootView = alignWithView.getParent( RootView );
        var position = atNode.getBoundingClientRect();
        var posTop = position.top;
        var posLeft = position.left;
        var posWidth = position.width;
        var posHeight = position.height;
        var aFlexEl = this._aFlex;
        var bFlexEl = this._bFlex;
        var popOverEl = this._popOver;
        var calloutEl = this._callout;
        var safeAreaInsetBottom = rootView.get( 'safeAreaInsetBottom' );
        var layout = {};
        var calloutStyle = '';
        var aFlex, bFlex, startDistance, endDistance;

        this.insertView( options.view, this._popOver );

        if ( safeAreaInsetBottom ) {
            layout.paddingBottom = safeAreaInsetBottom;
        }
        switch ( positionToThe ) {
        case 'top':
            layout.paddingBottom = Math.max( safeAreaInsetBottom,
                rootView.get( 'pxHeight' ) - posTop - offsetTop );
            break;
        case 'right':
            layout.paddingLeft = posLeft + posWidth + offsetLeft;
            break;
        case 'bottom':
            layout.paddingTop = posTop + posHeight + offsetTop;
            break;
        case 'left':
            layout.paddingRight =
                rootView.get( 'pxWidth' ) - posLeft - offsetLeft;
            break;
        }

        // 0% rather than 0 for IE11 compatibility due to Bug #4
        // in https://github.com/philipwalton/flexbugs
        switch ( alignEdge ) {
        case 'top':
            aFlex = '0 1 ' + ( posTop + offsetTop ) + 'px';
            bFlex = '1 0 0%';
            break;
        case 'middle':
            startDistance =
                Math.round( posTop + offsetTop + ( posHeight / 2 ) );
            endDistance = rootView.get( 'pxHeight' ) -
                safeAreaInsetBottom - startDistance;
            aFlex = startDistance + ' 0 0';
            bFlex = endDistance + ' 0 0';
            calloutStyle = 'top:' +
                ( 100 * startDistance / ( startDistance + endDistance ) ) + '%';
            break;
        case 'bottom':
            aFlex = '1 0 0%';
            bFlex = '0 1 ' + ( rootView.get( 'pxHeight' ) -
                ( posTop + posHeight + offsetTop ) ) + 'px';
            break;
        case 'left':
            aFlex = '0 1 ' + ( posLeft + offsetLeft ) + 'px';
            bFlex = '1 0 0%';
            break;
        case 'centre':
            startDistance =
                Math.round( posLeft + offsetLeft + ( posWidth / 2 ) );
            endDistance = rootView.get( 'pxWidth' ) - startDistance;
            aFlex = startDistance + ' 0 0';
            bFlex = endDistance + ' 0 0';
            calloutStyle = 'left:' +
                ( 100 * startDistance / ( startDistance + endDistance ) ) + '%';
            break;
        case 'right':
            aFlex = '1 0 0%';
            bFlex = '0 1 ' + ( rootView.get( 'pxWidth' ) -
                ( posLeft + posWidth + offsetLeft ) ) + 'px';
            break;
        }

        if ( !options.showCallout ) {
            calloutStyle = 'display:none';
        }

        aFlexEl.className = positionToTheLeftOrRight ?
            'v-PopOverContainer-top' : 'v-PopOverContainer-left';
        aFlexEl.style.cssText = 'flex:' + aFlex;
        bFlexEl.className = positionToTheLeftOrRight ?
            'v-PopOverContainer-bottom' : 'v-PopOverContainer-right';
        bFlexEl.style.cssText = 'flex:' + bFlex;
        popOverEl.style.cssText = '';
        calloutEl.style.cssText = calloutStyle;

        this.set( 'layout', layout )
            .redraw()
            .keepInBounds();
    },

    /**
        Property: O.PopOverView#parentMargin
        Type: {top: number, left: number, right: number, bottom: number}

        The popover will ensure that it is at least N pixels away from each edge
        of the parent view.
    */
    parentMargin: {
        top: 10,
        left: 10,
        right: 10,
        bottom: 10,
    },

    keepInBounds: function () {
        if ( !this.get( 'isInDocument' ) ) {
            return;
        }
        var rootView = this.get( 'parentView' );
        var popOverEl = this._popOver;
        var options = this.get( 'options' );
        var positionToThe = options.positionToThe;
        var positionToTheLeftOrRight =
            positionToThe === 'left' || positionToThe === 'right';
        var parentMargin = this.get( 'parentMargin' );
        var keepInVerticalBounds = options.keepInVerticalBounds;
        var keepInHorizontalBounds = options.keepInHorizontalBounds;
        var deltaLeft = 0;
        var deltaTop = 0;

        if ( keepInHorizontalBounds === undefined ) {
            keepInHorizontalBounds = !positionToTheLeftOrRight;
        }
        if ( keepInVerticalBounds === undefined ) {
            keepInVerticalBounds = positionToTheLeftOrRight;
        }

        // Check not run off screen. We only move it on the axis the pop over
        // has been positioned along. It is up to the contents to ensure the
        // pop over is not too long in the other direction.
        var position = popOverEl.getBoundingClientRect();
        var gap;

        if ( keepInHorizontalBounds ) {
            // Check right edge
            if ( !rootView.get( 'showScrollbarX' ) ) {
                gap = rootView.get( 'pxWidth' ) - position.right;
                // If gap is negative, move the view.
                if ( gap < 0 ) {
                    deltaLeft += gap;
                    deltaLeft -= parentMargin.right;
                }
            }

            // Check left edge
            gap = position.left + deltaLeft;
            if ( gap < 0 ) {
                deltaLeft -= gap;
                deltaLeft += parentMargin.left;
            }
        }
        if ( keepInVerticalBounds ) {
            // Check bottom edge
            if ( !rootView.get( 'showScrollbarY' ) ) {
                gap = rootView.get( 'pxHeight' ) - position.bottom;
                if ( gap < 0 ) {
                    deltaTop += gap;
                    deltaTop -= parentMargin.bottom;
                }
            }

            // Check top edge
            gap = position.top + deltaTop;
            if ( gap < 0 ) {
                deltaTop -= gap;
                deltaTop += parentMargin.top;
            }
        }

        Element$1.setStyle( this._popOver, 'transform',
            'translate(' + deltaLeft + 'px,' + deltaTop + 'px)' );
        Element$1.setStyle( this._callout, 'transform',
            'translate(' +
                ( positionToTheLeftOrRight ? 0 : -deltaLeft ) + 'px,' +
                ( positionToTheLeftOrRight ? -deltaTop : 0 ) + 'px)'
        );
    }.queue( 'after' ),

    viewNeedsRedraw: function () {
        this.propertyNeedsRedraw( this, 'layer' );
    }.observes( 'options' ),

    didResize: function didResize () {
        if ( !this._inResize ) {
            // We redraw layer styles as part of redrawing layer; don't get
            // stuck in infinite call stack!
            this._inResize = true;
            if ( this.get( 'options' ).alignWithView.get( 'isInDocument' ) ) {
                this.redrawLayer();
            } else {
                this.hide();
            }
            this._inResize = false;
        }
    },

    /*
        Options
        - view -> The view to append to the pop over
        - alignWithView -> the view to align to
        - atNode -> the node within the view to align to
        - positionToThe -> 'bottom'/'top'/'left'/'right'
        - alignEdge -> 'left'/'centre'/'right'/'top'/'middle'/'bottom'
        - showCallout -> true/false
        - offsetLeft
        - offsetTop
        - resistHiding -> true to stop clicking outside or pressing Esc closing
          the popover, false for normal behaviour; may also be a function
          returning true or false
          (incidental note: this would be nicer if options was an O.Object)
        - onHide: fn
    */
    show: function show ( options ) {
        var alignWithView = options.alignWithView;
        if ( alignWithView === this ) {
            return this.get( 'subPopOverView' ).show( options );
        }

        this.hide();
        this.set( 'options', options );
        alignWithView.getParent( RootView ).insertView( this );

        var eventHandler = this.get( 'eventHandler' );
        ViewEventsController.addEventTarget( eventHandler, 10 );
        this.set( 'isVisible', true );

        return this;
    },

    didEnterDocument: function didEnterDocument () {
        PopOverView.parent.didEnterDocument.call( this );
        this.getParent( RootView ).addObserverForKey(
            'safeAreaInsetBottom', this, 'viewNeedsRedraw' );
        return this;
    },

    willLeaveDocument: function willLeaveDocument () {
        this.getParent( RootView ).removeObserverForKey(
            'safeAreaInsetBottom', this, 'viewNeedsRedraw' );
        return PopOverView.parent.willLeaveDocument.call( this );
    },

    didLeaveDocument: function didLeaveDocument () {
        PopOverView.parent.didLeaveDocument.call( this );
        this.hide();
        return this;
    },

    hide: function hide () {
        if ( this.get( 'isVisible' ) ) {
            var subPopOverView = this.hasSubView() ?
                    this.get( 'subPopOverView' ) : null;
            var eventHandler = this.get( 'eventHandler' );
            var options = this.get( 'options' );
            var onHide;
            if ( subPopOverView ) {
                subPopOverView.hide();
            }
            this.set( 'isVisible', false )
                .detach()
                .removeView( this.get( 'childViews' )[0] );
            ViewEventsController.removeEventTarget( eventHandler );
            eventHandler._seenMouseDown = false;
            this.set( 'options', null );
            if (( onHide = options.onHide )) {
                onHide( options, this );
            }
        }
        return this;
    },

    hasSubView: function hasSubView () {
        return !!meta( this ).cache.subPopOverView &&
            this.get( 'subPopOverView' ).get( 'isVisible' );
    },

    subPopOverView: function () {
        return new PopOverView({ parentPopOverView: this });
    }.property(),

    eventHandler: function () {
        return new ModalEventHandler({ view: this });
    }.property(),

    softHide: function softHide () {
        var options = this.get( 'options' );
        if ( this.get( 'isVisible' ) && ( !options.resistHiding || (
                typeof options.resistHiding === 'function' &&
                !options.resistHiding() ) ) ) {
            this.hide();
        }
    },

    clickedOutside: function clickedOutside () {
        var view = this;
        var parent;
        while (( parent = view.get( 'parentPopOverView' ) )) {
            view = parent;
        }
        view.softHide();
    },

    keyOutside: function keyOutside ( event ) {
        this.get( 'childViews' )[0].fire( event.type, event );
    },

    closeOnEsc: function ( event ) {
        if ( lookupKey( event ) === 'Escape' ) {
            this.softHide();
        }
    }.on( 'keydown' ),

    stopEvents: function ( event ) {
        event.stopPropagation();
    }.on( 'click', 'mousedown', 'mouseup',
        'keypress', 'keydown', 'keyup', 'tap' ),
});

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

        const Element = O.Element,
            el = Element.create;

        Element.appendChildren( layer, [
            el( 'h1', [
                'Which pill will you take?'
            ]),
            el( 'div.actions', [
                new O.ButtonView({
                    type: 'v-Button--destructive v-Button--size13',
                    icon: el( 'i.icon.icon-redpill' ),
                    isDisabled: O.bind( controller, 'isNeo' ),
                    label: 'The Red Pill',
                    target: controller,
                    method: 'abort'
                }),
                new O.ButtonView({
                    type: 'v-Button--constructive v-Button--size13',
                    icon: el( 'i.icon.icon-bluepill' ),
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
            ${view.icon},
            <span class="label">${view.label}</span>
        </button>

    If there is no icon property set, a comment node will be inserted in its
    position.
*/
var ButtonView = Class({

    Extends: AbstractControlView,

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
        Property: O.ButtonView#isWaiting
        Type: Boolean
        Default: false

        Is the button waiting for something to complete? Setting this to true
        will disable the button and add an 'is-waiting' class name.
    */
    isWaiting: false,

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
        Type: Element|null
        Default: null

        An element to insert before the label.
    */
    icon: null,

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
            ( this.get( 'isWaiting' ) ? ' is-waiting' : '' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' );
    }.property( 'type', 'icon', 'shortcut', 'isActive', 'isWaiting',
                'isDisabled' ),

    /**
        Method: O.ButtonView#draw

        Overridden to draw view. See <O.View#draw>. For DOM structure, see
        general <O.ButtonView> notes.
    */
    draw: function draw ( layer, Element, el ) {
        var icon = this.get( 'icon' );
        if ( typeof icon === 'string' ) {
            icon = ButtonView.drawIcon( icon );
        } else if ( !icon ) {
            icon = document.createComment( 'icon' );
        }
        this._domControl = layer;
        return [
            icon,
            ButtonView.parent.draw.call( this, layer, Element, el ) ];
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.ButtonView#buttonNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    buttonNeedsRedraw: function ( self, property, oldValue ) {
        if ( property === 'isWaiting' ) {
            property = 'isDisabled';
        }
        return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'icon', 'isWaiting' ),

    redrawIcon: function redrawIcon ( layer ) {
        var icon = this.get( 'icon' );
        if ( typeof icon === 'string' ) {
            icon = ButtonView.drawIcon( icon );
        } else if ( !icon ) {
            icon = document.createComment( 'icon' );
        }
        layer.replaceChild( icon, layer.firstChild );
    },

    redrawIsDisabled: function redrawIsDisabled () {
        this._domControl.disabled =
            this.get( 'isDisabled' ) || this.get( 'isWaiting' );
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
    activate: function activate () {
        if ( !this.get( 'isDisabled' ) && !this.get( 'isWaiting' ) ) {
            var target = this.get( 'target' ) || this;
            var action;
            if ( ( action = this.get( 'action' ) ) ) {
                target.fire( action, { originView: this } );
            } else if ( ( action = this.get( 'method' ) ) ) {
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
    _setIgnoreUntil: function _setIgnoreUntil () {
        this._ignoreUntil = Date.now() + 200;
    },

    /**
        Method: O.ButtonView#mouseActivate

        Activates the button on normal clicks.

        Parameters:
            event - {Event} The click or mouseup event.
    */
    mouseActivate: function ( event ) {
        if ( this._ignoreUntil > Date.now() ||
                event.button || event.metaKey || event.ctrlKey ) {
            return;
        }
        if ( event.type !== 'mouseup' ||
                this.getParentWhere( function (x) { return x.isMenuView; } ) ) {
            this._ignoreUntil = 4102444800000; // 1st Jan 2100...
            RunLoop.invokeInNextEventLoop( this._setIgnoreUntil, this );
            this.activate();
            event.preventDefault();
            // Firefox keeps focus on the button after clicking. If the user
            // then hits "space", it will activate the button again!
            this.blur();
        }
    }.on( 'mouseup', 'click' ),

    /**
        Method: O.ButtonView#keyboardActivate

        Activates the button when it has keyboard focus and the `enter` or
        `space` key is pressed.

        Parameters:
            event - {Event} The keypress event.
    */
    keyboardActivate: function ( event ) {
        var key = lookupKey( event );
        if ( key === 'Enter' || key === 'Space' ) {
            this.activate();
            // Don't want to trigger global keyboard shortcuts
            event.stopPropagation();
        }
        if ( key === 'Escape' ) {
            this.blur();
            event.stopPropagation();
        }
    }.on( 'keydown' ),
});

ButtonView.drawIcon = function ( icon ) {
    return Element$1.create( 'i', {
        className: 'icon ' + icon,
    });
};

var MenuOptionView = Class({

    Extends: View,

    destroy: function destroy () {
        this.removeView( this.get( 'childViews' )[0] );
        MenuOptionView.parent.destroy.call( this );
    },

    isFocused: false,

    layerTag: 'li',

    className: function () {
        return 'v-MenuOption' +
            ( this.get( 'isFocused' ) ? ' is-focused' : '' );
    }.property( 'isFocused' ),

    draw: function draw (/* layer, Element, el */) {
        return this.get( 'content' ).get( 'button' );
    },

    _focusTimeout: null,

    takeFocus: function takeFocus () {
        if ( this.get( 'isInDocument' ) ) {
            this.get( 'controller' )
                .focus( this.get( 'content' ) )
                .expandFocused();
        }
    },

    mousemove: function () {
        if ( !this.get( 'isFocused' ) && !this._focusTimeout ) {
            var popOverView = this.getParent( PopOverView );
            if ( popOverView && popOverView.hasSubView() ) {
                this._focusTimeout = RunLoop.invokeAfterDelay(
                    this.takeFocus, 75, this );
            } else {
                this.takeFocus();
            }
        }
    }.on( 'mousemove' ),

    mouseout: function () {
        if ( this._focusTimeout ) {
            RunLoop.cancel( this._focusTimeout );
            this._focusTimeout = null;
        }
        if ( this.get( 'isFocused' ) &&
                !this.get( 'childViews' )[0].get( 'isActive' ) ) {
            this.get( 'controller' ).focus( null );
        }
    }.on( 'mouseout' ),
});

/**
    Class: O.MenuButtonView

    Extends: O.ButtonView

    A MenuButtonView reveals a menu when pressed. Example usage:

        new O.MenuButtonView({
            label: 'Select File',
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
var MenuButtonView = Class({

    Extends: ButtonView,

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
        return this.get( 'parentView' ) instanceof MenuOptionView;
    }.property( 'parentView' ),

    // --- Accessibility ---

    didCreateLayer: function didCreateLayer ( layer ) {
        layer.setAttribute( 'aria-expanded', 'false' );
    },

    ariaNeedsRedraw: function ( self, property, oldValue ) {
        return this.propertyNeedsRedraw( self, 'aria', oldValue );
    }.observes( 'isActive' ),

    redrawAria: function redrawAria ( layer ) {
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
    activate: function activate () {
        if ( !this.get( 'isActive' ) && !this.get( 'isDisabled' ) ) {
            this.set( 'isActive', true );
            var buttonView = this;
            var popOverView, menuOptionView, rootView, position;
            var popOverOptions = Object.assign({
                    view: this.get( 'menuView' ),
                    alignWithView: buttonView,
                    alignEdge: this.get( 'alignMenu' ),
                    onHide: function onHide () {
                        buttonView.set( 'isActive', false );
                        if ( menuOptionView ) {
                            menuOptionView.removeObserverForKey(
                                'isFocused', popOverView, 'hide' );
                        }
                    },
                }, this.get( 'popOverOptions' ) );
            if ( this.get( 'isInMenu' ) ) {
                popOverView = this.getParent( PopOverView );
                menuOptionView = this.get( 'parentView' );
                rootView = this.getParent( RootView );
                position = this.get( 'layer' ).getBoundingClientRect();
                popOverOptions.alignWithView = popOverView;
                popOverOptions.atNode = this.get( 'layer' );
                popOverOptions.positionToThe =
                    position.left < rootView.get( 'pxWidth' ) - position.right ?
                            'right' : 'left';
                popOverOptions.showCallout = false;
                popOverOptions.alignEdge = 'top';
                popOverOptions.offsetTop =
                    popOverOptions.view.get( 'showFilter' ) ? -35 : -5;
                popOverOptions.offsetLeft = 0;
            } else {
                popOverView = this.get( 'popOverView' );
            }
            // If the isInMenu, the popOverView used will actually be a subview
            // of this popOverView, and is returned from the show method.
            popOverView = popOverView.show( popOverOptions );
            if ( menuOptionView ) {
                menuOptionView.get( 'controller' ).addObserverForKey(
                    'focused', popOverView, 'hide' );
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
    }.on( 'mousedown' ),
});

var OptionsController = Class({

    Extends: Obj,

    init: function init () {
        this.isFiltering = false;
        this.focused = null;
        this.selected = null;
        OptionsController.parent.constructor.apply( this, arguments );
        this.setOptions();
    },

    // ---

    search: '',

    resetSearch: function resetSearch () {
        this.set( 'search', '' );
    },

    // ---

    setOptions: function setOptions () {
        var options = this.get( 'options' );
        var content = this.get( 'content' );
        var search = this.get( 'search' );
        var isFiltering = this.get( 'isFiltering' );
        var results = this.filterOptions( content, search, isFiltering );

        if ( options instanceof ObservableArray ) {
            options.set( '[]', results );
        } else {
            this.set( 'options', results );
        }
        this.checkFocus();
    },

    optionsWillChange: function () {
        this.setOptions();
    }.queue( 'before' ).observes( 'content', 'search', 'isFiltering' ),

    filterOptions: function filterOptions ( content, search/*, isFiltering*/ ) {
        var pattern = search ? LocaleController.makeSearchRegExp( search ) : null;
        return pattern ? content.filter( function ( option ) {
            return pattern.test( option.get( 'name' ) );
        }) : Array.isArray( content ) ? content : content.get( '[]' );
    },

    // ---

    getAdjacent: function getAdjacent ( step ) {
        var options = this.get( 'options' );
        var l = options.get( 'length' );
        var i = options.indexOf( this.get( 'focused' ) );

        if ( i < 0 && step < 0 ) {
            i = l;
        }
        var current = i.mod( l );

        do {
            i = ( i + step ).mod( l );
        } while ( l &&
            !this.mayFocus( options.getObjectAt( i ) ) && i !== current );

        return options.getObjectAt( i );
    },

    focusPrevious: function focusPrevious () {
        return this.focus( this.getAdjacent( -1 ) );
    },

    focusNext: function focusNext () {
        return this.focus( this.getAdjacent( 1 ) );
    },

    mayFocus: function mayFocus ( option ) {
        return !option.get( 'isDisabled' );
    },

    focus: function focus ( option ) {
        var current = this.get( 'focused' );
        if ( current !== option ) {
            if ( option && !this.mayFocus( option ) ) {
                option = null;
            }
            this.set( 'focused', option );
        }
        return this;
    },

    checkFocus: function () {
        var focused = this.get( 'focused' );
        if ( !this.get( 'isFiltering' ) ) {
            this.focus( null );
        } else if ( !focused || !this.mayFocus( focused ) ||
                !this.get( 'options' ).contains( focused ) ) {
            this.focus( null ).focusNext();
        }
    }.observes( 'isFiltering' ),

    // ---

    collapseFocused: function collapseFocused () {},
    expandFocused: function expandFocused () {},

    selectFocused: function selectFocused () {
        var focused = this.get( 'focused' );
        if ( focused ) {
            this.select( focused );
            this.resetSearch();
        }
    },

    // ---

    select: function select () {},

    done: function () {
        this.set( 'isFiltering', false )
            .fire( 'done' );
    }.observes( 'selected' ),
});

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
                   have not yet loaded.
*/

// Core states:
var EMPTY        =   1;
var READY        =   2;
var DESTROYED    =   4;
var NON_EXISTENT =   8;

// Properties:
var LOADING      =  16;
var COMMITTING   =  32;
var NEW          =  64;
var DIRTY        = 128;
var OBSOLETE     = 256;


var Status = Object.freeze({
    EMPTY: EMPTY,
    READY: READY,
    DESTROYED: DESTROYED,
    NON_EXISTENT: NON_EXISTENT,
    LOADING: LOADING,
    COMMITTING: COMMITTING,
    NEW: NEW,
    DIRTY: DIRTY,
    OBSOLETE: OBSOLETE
});

var byIndex = function ( a, b ) {
    return a.get( 'index' ) - b.get( 'index' );
};

var addToTable = function ( array, table ) {
    for ( var i = 0, l = array.length; i < l; i += 1 ) {
        table[ array[i] ] = true;
    }
    return table;
};

var getNextViewIndex = function ( childViews, newRendered, fromIndex ) {
    var length = childViews.length;
    var view, item;
    while ( fromIndex < length ) {
        view = childViews[ fromIndex ];
        item = view.get( 'content' );
        if ( item && newRendered[ guid( item ) ] ) {
            break;
        }
        fromIndex += 1;
    }
    return fromIndex;
};

var ListView = Class({

    Extends: View,

    content: null,
    contentLength: bind( 'content.length' ),

    ItemView: null,
    itemHeight: 0,

    init: function init (/* ...mixins */) {
        this._added = null;
        this._removed = null;
        this._rendered = {};
        this._renderRange = {
            start: 0,
            end: 0x7fffffff, // Max positive signed 32bit int: 2^31 - 1
        };

        this.controller = null;
        this.focused = null;
        this.selection = null;

        ListView.parent.constructor.apply( this, arguments );

        var focused = this.get( 'focused' );
        if ( focused ) {
            focused.addObserverForKey( 'record', this, 'redrawFocused' );
        }

        var selection = this.get( 'selection' );
        if ( selection ) {
            selection.addObserverForKey(
                'selectedStoreKeys', this, 'redrawSelection' );
        }
    },

    destroy: function destroy () {
        var selection = this.get( 'selection' );
        if ( selection ) {
            selection.removeObserverForKey(
                'selectedStoreKeys', this, 'redrawSelection' );
        }

        var focused = this.get( 'focused' );
        if ( focused ) {
            focused.removeObserverForKey( 'record', this, 'redrawFocused' );
        }

        if ( this.get( 'isRendered' ) ) {
            var content = this.get( 'content' );
            if ( content ) {
                content.removeObserverForRange(
                    this._renderRange, this, 'viewNeedsRedraw' );
                content.off( 'query:updated', this, 'contentWasUpdated' );
            }
        }

        ListView.parent.destroy.call( this );
    },

    contentDidChange: function ( _, __, oldVal, newVal ) {
        if ( this.get( 'isRendered' ) ) {
            var range = this._renderRange;
            if ( oldVal ) {
                oldVal.removeObserverForRange( range, this, 'viewNeedsRedraw' );
                oldVal.off( 'query:updated', this, 'contentWasUpdated' );
            }
            if ( newVal ) {
                newVal.addObserverForRange( range, this, 'viewNeedsRedraw' );
                newVal.on( 'query:updated', this, 'contentWasUpdated' );
            }
            this.viewNeedsRedraw();
        }
    }.observes( 'content' ),

    contentWasUpdated: function contentWasUpdated ( event ) {
        if ( this.get( 'isInDocument' ) ) {
            this._added = addToTable( event.added, this._added || {} );
            this._removed = addToTable( event.removed, this._removed || {} );
        }
    },

    layout: function () {
        var itemHeight = this.get( 'itemHeight' );
        var height = itemHeight * ( this.get( 'contentLength' ) || 0 );
        // Firefox breaks in weird and wonderful ways when a scroll area is
        // over a certain height, somewhere between 2^24 and 2^25px tall.
        // 2^24 = 16,777,216
        if ( UA.firefox && height > 16777216 ) {
            height = 16777216;
        }
        return itemHeight ? { height: height } : {};
    }.property( 'itemHeight', 'contentLength' ),

    draw: function draw ( layer, Element/*, el*/ ) {
        // Render any unmanaged child views first.
        var children = ListView.parent.draw.call( this, layer );
        var content = this.get( 'content' );
        if ( children ) {
            Element.appendChildren( layer, children );
        }
        if ( content ) {
            content.addObserverForRange(
                this._renderRange, this, 'viewNeedsRedraw' );
            content.on( 'query:updated', this, 'contentWasUpdated' );
            this.redrawLayer( layer );
        }
    },

    viewNeedsRedraw: function viewNeedsRedraw () {
        this.propertyNeedsRedraw( this, 'layer' );
    },

    // -----------------------------------------------------------------------

    isCorrectItemView: function isCorrectItemView (/* view, item */) {
        return true;
    },

    createItemView: function createItemView ( content, index, list, isAdded ) {
        var ItemView = this.get( 'ItemView' );
        var focused = this.get( 'focused' );
        var view = new ItemView({
            controller: this.get( 'controller' ),
            selection: this.get( 'selection' ),
            parentView: this,
            content: content,
            index: index,
            list: list,
            isAdded: isAdded,
        });
        if ( focused ) {
            view.set( 'isFocused', content === focused.get( 'record' ) );
        }
        return view;
    },

    destroyItemView: function destroyItemView ( view ) {
        view.destroy();
    },

    redrawLayer: function redrawLayer ( layer ) {
        var this$1 = this;

        var list = this.get( 'content' ) || [];
        var childViews = this.get( 'childViews' );
        var isInDocument = this.get( 'isInDocument' );
        // Limit to this range in the content array.
        var renderRange = this._renderRange;
        var start = Math.max( 0, renderRange.start );
        var end = Math.min( list.get( 'length' ), renderRange.end );
        // Set of already rendered views.
        var rendered = this._rendered;
        var newRendered = this._rendered = {};
        // Are they new or always been there?
        var added = this._added;
        var removed = this._removed;
        // Bookkeeping
        var viewsDidEnterDoc = [];
        var moved = new Set();
        var frag = null;
        var currentViewIndex;
        var viewIsInCorrectPosition, i, l, item, id, view, isAdded, isRemoved;

        // Mark views we still need
        for ( i = start, l = end; i < l; i += 1 ) {
            item = list.getObjectAt( i );
            id = item ? guid( item ) : 'null:' + i;
            view = rendered[ id ];
            if ( view && this$1.isCorrectItemView( view, item, i ) ) {
                newRendered[ id ] = view;
            }
        }

        this.beginPropertyChanges();

        // Remove ones which are no longer needed
        for ( id in rendered ) {
            if ( !newRendered[ id ] ) {
                view = rendered[ id ];
                isRemoved = removed && ( item = view.get( 'content' ) ) ?
                    removed[ item.get( 'storeKey' ) ] : false;
                view.detach( isRemoved );
                this$1.destroyItemView( view );
            }
        }
        currentViewIndex = getNextViewIndex( childViews, newRendered, 0 );

        // Create/update views in render range
        for ( i = start, l = end; i < l; i += 1 ) {
            item = list.getObjectAt( i );
            id = item ? guid( item ) : 'null:' + i;
            view = newRendered[ id ];
            // Was the view already in the list?
            if ( view ) {
                // Is it in the correct position?
                viewIsInCorrectPosition =
                    childViews[ currentViewIndex ] === view;
                // If not, remove
                if ( !viewIsInCorrectPosition ) {
                    // Suspend property changes so we don't redraw layout
                    // until back in the document, so that animation works
                    if ( isInDocument ) {
                        moved.add( view );
                        view.beginPropertyChanges();
                        view.willLeaveDocument();
                    }
                    layer.removeChild( view.get( 'layer' ) );
                    if ( isInDocument ) {
                        view.didLeaveDocument();
                    }
                }
                // Always update list/index
                view.set( 'index', i )
                    .set( 'list', list );
                // If in correct position, all done
                if ( viewIsInCorrectPosition ) {
                    if ( frag ) {
                        layer.insertBefore( frag, view.get( 'layer' ) );
                        frag = null;
                    }
                    currentViewIndex =
                        getNextViewIndex(
                            childViews, newRendered, currentViewIndex + 1 );
                    continue;
                }
            } else {
                isAdded = added && item ?
                    added[ item.get( 'storeKey' ) ] : false;
                view = this$1.createItemView( item, i, list, isAdded );
                if ( !view ) {
                    continue;
                }
                newRendered[ id ] = view;
                childViews.push( view );
            }
            if ( !frag ) {
                frag = layer.ownerDocument.createDocumentFragment();
            }
            frag.appendChild( view.render().get( 'layer' ) );
            if ( isInDocument ) {
                view.willEnterDocument();
                viewsDidEnterDoc.push( view );
            }
        }
        if ( frag ) {
            layer.appendChild( frag );
        }
        if ( isInDocument && viewsDidEnterDoc.length ) {
            for ( i = 0, l = viewsDidEnterDoc.length; i < l; i += 1 ) {
                view = viewsDidEnterDoc[i];
                view.didEnterDocument();
                if ( moved.has( view ) ) {
                    view.endPropertyChanges();
                }
            }
        }

        childViews.sort( byIndex );

        this._added = null;
        this._removed = null;
        this.propertyDidChange( 'childViews' );
        this.endPropertyChanges();
    },

    redrawFocused: function redrawFocused ( _, __, oldRecord ) {
        var rendered = this._rendered;
        var newRecord = this.get( 'focused' ).get( 'record' );
        if ( oldRecord ) {
            var view = rendered[ guid( oldRecord ) ];
            if ( view ) {
                view.set( 'isFocused', false );
            }
        }
        if ( newRecord ) {
            var view$1 = rendered[ guid( newRecord ) ];
            if ( view$1 ) {
                view$1.set( 'isFocused', true );
            }
        }
    },

    redrawSelection: function redrawSelection () {
        var selection = this.get( 'selection' );
        var itemViews = this.get( 'childViews' );
        var l = itemViews.length;
        while ( l-- ) {
            var view = itemViews[l];
            var storeKey = view.getFromPath( 'content.storeKey' );
            if ( storeKey ) {
                view.set( 'isSelected',
                    selection.isStoreKeySelected( storeKey ) );
            }
        }
    },

    // --- Can't add views by hand; just bound to content ---

    insertView: null,
    replaceView: null,
});

var OptionsListView = Class({

    Extends: ListView,

    init: function init () {
        this._focusedOption = null;
        this._selectedOption = null;
        this._views = {};

        OptionsListView.parent.constructor.apply( this, arguments );
    },

    layerTag: 'ul',

    itemHeightDidChange: function () {
        var itemHeight = this.get( 'itemHeight' );
        var views = this._views;
        for ( var id in views ) {
            views[ id ].set( 'itemHeight', itemHeight );
        }
    }.observes( 'itemHeight' ),

    // ---

    focusedOption: bind( 'controller*focused' ),
    selectedOption: bind( 'controller*selected' ),

    createItemView: function createItemView ( item, index, list ) {
        var itemHeight = this.get( 'itemHeight' );
        var id = guid( item );
        var View = this.getViewTypeForItem( item );
        var view = this._views[ id ];

        if ( view ) {
            view.set( 'index', index )
                .set( 'list', list )
                .set( 'parentView', this );
        } else {
            var isFocused = ( item === this.get( 'focusedOption' ) );
            var isSelected = ( item === this.get( 'selectedOption' ) );
            view = this._views[ id ] = new View({
                controller: this.get( 'controller' ),
                parentView: this,
                content: item,
                index: index,
                list: list,
                itemHeight: itemHeight,
                isFocused: isFocused,
                isSelected: isSelected,
            });
            if ( isFocused ) {
                this._focusedOption = view;
            }
            if ( isSelected ) {
                this._selectedOption = view;
            }
        }
        return view;
    },

    destroyItemView: function destroyItemView ( view ) {
        var item = view.get( 'content' );
        if ( item.isDestroyed || ( item.is && item.is( DESTROYED ) ) ) {
            view.destroy();
            delete this._views[ guid( item ) ];
        }
    },

    getView: function getView ( item ) {
        return this._views[ guid( item ) ] || null;
    },

    redrawFocused: function () {
        var item = this.get( 'focusedOption' );
        var oldView = this._focusedOption;
        var newView = item && this.getView( item );
        if ( oldView !== newView ) {
            if ( oldView ) {
                oldView.set( 'isFocused', false );
            }
            if ( newView ) {
                newView.set( 'isFocused', true );
                this.scrollIntoView( newView );
            }
            this._focusedOption = newView;
        }
    }.observes( 'focusedOption' ),

    redrawSelected: function () {
        var item = this.get( 'selectedOption' );
        var oldView = this._selectedOption;
        var newView = item && this.getView( item );
        if ( oldView !== newView ) {
            if ( oldView ) {
                oldView.set( 'isSelected', false );
            }
            if ( newView ) {
                newView.set( 'isSelected', true );
                this.scrollIntoView( newView );
            }
            this._selectedOption = newView;
        }
    }.observes( 'selectedOption' ),

    scrollIntoView: function scrollIntoView ( view ) {
        var scrollView = this.getParent( ScrollView );
        if ( !scrollView || !this.get( 'isInDocument' ) ) {
            return;
        }
        var scrollHeight = scrollView.get( 'pxHeight' );
        var scrollTop = scrollView.get( 'scrollTop' );
        var top = view.getPositionRelativeTo( scrollView ).top;
        var height = view.get( 'pxHeight' );

        if ( top < scrollTop ) {
            scrollView.scrollTo( 0, top - ( height >> 1 ), true );
        } else if ( top + height > scrollTop + scrollHeight ) {
            scrollView.scrollTo( 0,
                top + height - scrollHeight + ( height >> 1 ), true );
        }
    },
});

/*global document */

var isFirefox = !!UA.firefox;

/**
    Class: O.TextView

    Extends: O.AbstractControlView

    A text input control. The `value` property is two-way bindable, representing
    the input text.
*/
var TextView = Class({

    Extends: AbstractControlView,

    init: function init (/* ...mixins */) {
        TextView.parent.constructor.apply( this, arguments );
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
        autocomplete: 'off',
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
        var control = this._domControl;
        var isNumber = ( typeof selection === 'number' );
        var start = selection ? isNumber ?
                    selection : selection.start : 0;
        var end = selection ? isNumber ?
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
            end: end,
        };
    }.property().nocache(),

    /**
        Property: O.TextView#blurOnKeys
        Type: Object
        Default: { Escape: true }

        For each truthy value in the object, if the user is focused in the
        text view and hits the key, the focus will be removed.
    */
    blurOnKeys: { Escape: true },

    // --- Render ---

    /**
        Property: O.TextView#type
        Type: String

        Will be added to the view's class name.
    */
    type: '',

    layerTag: 'span',

    /**
        Property: O.TextView#className
        Type: String

        Overrides default in <O.View#className>. Will have the class `v-Text`,
        and any classes given in the <#type> property, along with the following
        other class names dependent on state:

        is-highlight - The <#isHighlighted> property is true.
        is-focused  - The <#isFocused> property is true.
        is-invalid   - The <#isValid> property is false.
        is-disabled  - The <#isDisabled> property is true.
    */
    className: function () {
        var type = this.get( 'type' );
        return 'v-Text' +
            ( this.get( 'isExpanding' ) ? ' v-Text--expanding' : '' ) +
            ( this.get( 'isHighlighted' ) ? ' is-highlighted' : '' ) +
            ( this.get( 'isFocused' ) ? ' is-focused' : '' ) +
            ( this.get( 'isValid' ) ? '' : ' is-invalid' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' ) +
            ( type ? ' ' + type : '' );
    }.property( 'type', 'isExpanding', 'isHighlighted',
        'isFocused', 'isValid', 'isDisabled' ),

    layerStyles: function () {
        return Object.assign({
            position: this.get( 'positioning' ),
            display: this.get( 'isMultiline' ) ? 'block' : 'inline-block',
            cursor: 'text',
            userSelect: 'text',
        }, this.get( 'layout' ) );
    }.property( 'layout', 'positioning' ),

    /**
        Method: O.TextView#draw

        Overridden to draw view. See <O.View#draw>.
    */
    draw: function draw ( layer, Element, el ) {
        var isMultiline = this.get( 'isMultiline' );
        var control = this._domControl = el(
                isMultiline ? 'textarea' : 'input', {
                    id: this.get( 'id' ) + '-input',
                    className: 'v-Text-input',
                    rows: isMultiline ? '1' : undefined,
                    name: this.get( 'name' ),
                    type: this.get( 'inputType' ),
                    disabled: this.get( 'isDisabled' ),
                    tabIndex: this.get( 'tabIndex' ),
                    placeholder: this.get( 'placeholder' ) || undefined,
                    value: this.get( 'value' ),
                });

        this.redrawInputAttributes();

        layer.title = this.get( 'tooltip' );

        return [
            control ];
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
    }.observes( 'isExpanding', 'value', 'placeholder', 'inputAttributes' ),

    /**
        Method: O.TextView#redrawValue

        Updates the content of the `<textarea>` or `<input>` to match the
        <#value> property.
    */
    redrawValue: function redrawValue () {
        this._domControl.value = this.get( 'value' );
    },

    /**
        Method: O.TextView#redrawPlaceholder

        Updates the placeholder text in the DOM when the <#placeholder> property
        changes.
    */
    redrawPlaceholder: function redrawPlaceholder () {
        this._domControl.placeholder = this.get( 'placeholder' );
    },

    /**
        Method: O.TextView#redrawInputAttributes

        Updates any other properties of the `<input>` element.
    */
    redrawInputAttributes: function redrawInputAttributes () {
        var inputAttributes = this.get( 'inputAttributes' );
        var control = this._domControl;
        for ( var property in inputAttributes ) {
            control.set( property, inputAttributes[ property ] );
        }
    },

    redrawTextHeight: function redrawTextHeight () {
        // Firefox gets pathologically slow when resizing really large text
        // areas, so automatically turn this off in such a case.
        // 2^13 chars is an arbitrary cut off point that seems to be reasonable
        // in practice
        if ( isFirefox && ( this.get( 'value' ) || '' ).length > 8192 ) {
            this.set( 'isExpanding', false );
            return;
        }
        var control = this._domControl;
        var style = control.style;
        var scrollView = this.getParent( ScrollView );
        // Set to auto to collapse it back to one line, otherwise it would
        // never shrink if you delete text.
        style.height = 'auto';
        var scrollHeight = control.scrollHeight;
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

    redrawIsExpanding: function redrawIsExpanding () {
        if ( this.get( 'isExpanding' ) ) {
            this.redrawTextHeight();
        } else {
            this._domControl.style.height = 'auto';
            // Scroll to cursor
            if ( this.get( 'isFocused' ) ) {
                this.blur().focus();
            }
        }
    },

    redrawLabel: function redrawLabel () {},

    // --- Activate ---

    /**
        Method: O.TextView#activate

        Overridden to focus the text view. See <O.AbstractControlView#activate>.
    */
    activate: function activate () {
        this.focus();
    },

    selectAll: function selectAll () {
        return this.set( 'selection', {
            start: 0,
            end: this.get( 'value' ).length,
        });
    },

    copySelectionToClipboard: function copySelectionToClipboard () {
        var focused = null;
        if ( !this.get( 'isFocused' ) ) {
            focused = document.activeElement;
            this.focus();
        }
        var didSucceed = false;
        try {
            didSucceed = document.execCommand( 'copy' );
        }  catch ( error ) {}
        if ( focused ) {
            focused.focus();
        }
        return didSucceed;
    },

    // --- Scrolling and focus ---

    savedSelection: null,

    /**
        Method: O.TextView#didEnterDocument

        Overridden to restore scroll position and selection. See
        <O.View#didEnterDocument>.
    */
    didEnterDocument: function didEnterDocument () {
        TextView.parent.didEnterDocument.call( this );
        if ( this.get( 'isMultiline' ) ) {
            if ( this.get( 'isExpanding' ) ) {
                this.redrawTextHeight();
            }
            // Restore scroll positions:
            var control = this._domControl;
            var left = this.get( 'scrollLeft' );
            var top = this.get( 'scrollTop' );
            if ( left ) {
                control.scrollLeft = left;
            }
            if ( top ) {
                control.scrollTop = top;
            }
            control.addEventListener( 'scroll', this, false );
        }
        var selection = this.get( 'savedSelection' );
        if ( selection ) {
            this.set( 'selection', selection ).focus();
            this.set( 'savedSelection', null );
        }
        return this;
    },

    /**
        Method: O.TextView#willLeaveDocument

        Overridden to save scroll position and selection. See
        <O.View#willLeaveDocument>.
    */
    willLeaveDocument: function willLeaveDocument () {
        // If focused, save cursor position
        if ( this.get( 'isFocused' ) ) {
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
        var control = this._domControl;
        var left = control.scrollLeft;
        var top = control.scrollTop;

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
        this.set( 'value', this._domControl.value );
        this._settingFromInput = false;
    }.on( 'input' ),

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
        // If key == enter, IE will automatically focus the nearest button
        // (presumably as though it were submitting the form). Stop this
        // unless we're actually in a form.
        if ( !this.get( 'isMultiline' ) &&
                lookupKey( event, true ) === 'Enter' &&
                !Element$1.nearest( this.get( 'layer' ), 'FORM' ) ) {
            event.preventDefault();
        }
    }.on( 'keypress' ),

    /**
        Method (private): O.TextView#_blurOnKey

        Blur the text area when the user hits certain keys, provided by the
        <#blurOnKeys> property.

        Parameters:
            event - {Event} The keyup event.
    */
    _blurOnKey: function ( event ) {
        var key = lookupKey( event, true );
        if ( this.get( 'blurOnKeys' )[ key ] ) {
            this.blur();
        }
    }.on( 'keyup' ),
});

var ClearSearchButtonView = Class({

    Extends: ButtonView,

    className: 'v-ClearSearchButton',
    positioning: 'absolute',
    shortcut: 'Ctrl-/',
});

var SearchTextView = Class({

    Extends: TextView,

    type: 'v-SearchText',

    icon: null,

    // Helps password managers know this is not a username input!
    name: 'search',

    draw: function draw ( layer, Element, el ) {
        var children =
                SearchTextView.parent.draw.call( this, layer, Element, el );
        children.push(
            this.get( 'icon' ),
            Element.when( this, 'value' ).show([
                new ClearSearchButtonView({
                    label: loc( 'Clear Search' ),
                    target: this,
                    method: 'reset',
                }) ]).end()
        );
        return children;
    },

    reset: function reset () {
        this.set( 'value', '' )
            .blur();
    },
});

var MenuFilterView = Class({

    Extends: View,

    isFiltering: bind( 'controller*isFiltering' ),

    ariaAttributes: {
        hidden: 'true',
    },

    className: function () {
        return 'v-MenuFilter' +
            ( this.get( 'isFiltering' ) ? ' is-filtering' : '' );
    }.property( 'isFiltering' ),

    draw: function draw (/* layer, Element, el */) {
        var controller = this.get( 'controller' );
        var searchTextView = this._input = new SearchTextView({
            shortcut: this.get( 'shortcut' ),
            tabIndex: -1,
            blurOnKeys: {},
            value: bindTwoWay( controller, 'search' ),
        });

        return searchTextView;
    },

    // ---

    focus: function focus () {
        this._input.focus();
        return this;
    },

    blur: function blur () {
        this._input.blur();
        return this;
    },

    setup: function () {
        var controller = this.get( 'controller' );
        if ( this.get( 'isInDocument' ) ) {
            controller.on( 'done', this, 'blur' );
        } else {
            controller.off( 'done', this, 'blur' );
        }
    }.observes( 'isInDocument' ),

    // ---

    didFocus: function () {
        this.get( 'controller' ).set( 'isFiltering', true );
    }.on( 'focus' ),

    handler: function () {
        return new Obj({
            view: this._input,
            controller: this.get( 'controller' ),
            done: function () {
                if ( !this.view.get( 'isFocused' ) ) {
                    this.controller.set( 'isFiltering', false );
                }
            }.on( 'click', 'keydown' ),
        });
    }.property(),

    captureEvents: function ( _, __, ___, isFiltering ) {
        var handler = this.get( 'handler' );
        if ( isFiltering ) {
            ViewEventsController.addEventTarget( handler, -5 );
        } else {
            ViewEventsController.removeEventTarget( handler );
        }
    }.observes( 'isFiltering' ),

    // ---

    keydown: function ( event ) {
        var controller = this.get( 'controller' );
        switch ( lookupKey( event ) ) {
        case 'Escape':
            if ( controller.get( 'search' ) ) {
                controller.resetSearch();
            } else {
                controller.done();
            }
            break;
        case 'Enter':
            controller.selectFocused();
            break;
        case 'ArrowUp':
            controller.focusPrevious();
            break;
        case 'ArrowDown':
            controller.focusNext();
            break;
        case 'ArrowLeft':
            if ( !controller.collapseFocused() ) {
                return;
            }
            break;
        case 'ArrowRight':
            if ( !controller.expandFocused() ) {
                return;
            }
            break;
        default:
            return;
        }
        event.stopPropagation();
        event.preventDefault();
    }.on( 'keydown' ),
});

var MenuOption = Class({

    Extends: Obj,

    init: function init ( button, controller ) {
        this.button = button;
        this.controller = controller;
    },

    isDisabled: function () {
        return this.get( 'button' ).get( 'isDisabled' );
    }.property().nocache(),

    name: function () {
        return this.get( 'button' ).get( 'label' );
    }.property().nocache(),
});

var MenuController = Class({

    Extends: OptionsController,

    init: function init ( view, content, isFiltering ) {
        var this$1 = this;

        this.options = new ObservableArray();
        this.view = view;
        this.content = content.map(
            function (button) { return new MenuOption( button, this$1 ); }
        );
        MenuController.parent.constructor.call( this, {
            isFiltering: isFiltering,
        });
    },

    collapseFocused: function collapseFocused () {
        var view = this.get( 'view' );
        var popOverView;
        if ( !view.get( 'showFilter' ) &&
                ( popOverView = view.getParent( PopOverView ) ) &&
                  popOverView.get( 'parentPopOverView' ) ) {
            view.hide();
        }
    },

    expandFocused: function expandFocused () {
        var focused = this.get( 'focused' );
        if ( focused && focused.get( 'button' ) instanceof MenuButtonView ) {
            this.selectFocused();
        }
    },

    select: function select ( item ) {
        var button = item.get( 'button' );
        if ( button.activate ) {
            button.activate();
        }
    },

    done: function done () {
        this.get( 'view' ).hide();
    },

    // ---

    viewMayHaveResized: function () {
        this.get( 'view' ).parentViewDidResize();
    }.queue( 'after' ).observes( 'search' ),
});

var MenuView = Class({

    Extends: View,

    className: 'v-Menu',

    isMenuView: true,
    showFilter: false,
    closeOnActivate: true,

    controller: function () {
        return new MenuController( this,
            this.get( 'options' ), this.get( 'showFilter' ) );
    }.property(),

    didEnterDocument: function didEnterDocument () {
        MenuView.parent.didEnterDocument.call( this );

        var layer = this.get( 'layer' );
        layer.addEventListener( 'mousemove', this, false );
        layer.addEventListener( 'mouseout', this, false );

        return this;
    },

    didLeaveDocument: function didLeaveDocument () {
        var controller = this.get( 'controller' );
        var layer = this.get( 'layer' );

        if ( this.get( 'showFilter' ) ) {
            controller.set( 'search', '' );
        } else {
            controller.focus( null );
        }

        layer.removeEventListener( 'mouseout', this, false );
        layer.removeEventListener( 'mousemove', this, false );

        return MenuView.parent.didLeaveDocument.call( this );
    },

    ItemView: MenuOptionView,

    draw: function draw (/* layer, Element, el */) {
        var this$1 = this;

        var controller = this.get( 'controller' );
        return [
            this.filterView =
            this.get( 'showFilter' ) ?
            new MenuFilterView({
                controller: controller,
            }) : null,
            this.scrollView = new ScrollView({
                positioning: 'relative',
                layout: {},
                childViews: [
                    new OptionsListView({
                        controller: controller,
                        layerTag: 'ul',
                        content: bind( controller, 'options' ),
                        getViewTypeForItem: function () { return this$1.get( 'ItemView' ); },
                    }) ],
            }) ];
    },

    hide: function hide () {
        var parent = this.get( 'parentView' );
        if ( parent ) {
            RunLoop.invokeInNextFrame( parent.hide, parent );
        }
    },

    buttonDidActivate: function () {
        if ( this.get( 'closeOnActivate' ) ) {
            var popOverView = this.getParent( PopOverView ) ||
                    this.get( 'parentView' );
            var parent;
            if ( popOverView ) {
                while (( parent = popOverView.get( 'parentPopOverView' ) )) {
                    popOverView = parent;
                }
                popOverView.hide();
            }
        }
    }.nextFrame().on( 'button:activate' ),

    keydown: function ( event ) {
        var key = lookupKey( event );
        var controller = this.get( 'controller' );
        switch ( key ) {
        case 'Enter':
            controller.selectFocused();
            break;
        case 'ArrowUp':
            controller.focusPrevious();
            break;
        case 'ArrowDown':
            controller.focusNext();
            break;
        case 'ArrowLeft':
            if ( !controller.collapseFocused() ) {
                return;
            }
            break;
        case 'ArrowRight':
            if ( !controller.expandFocused() ) {
                return;
            }
            break;
        default:
            if ( !this.get( 'showFilter' ) ) {
                var handler = ViewEventsController
                    .kbShortcuts.getHandlerForKey( key );
                var parent, object, method;
                if ( handler ) {
                    parent = object = handler[0];
                    method = handler[1];
                    // Check object is child view of the menu; we want to
                    // ignore any other keyboard shortcuts.
                    if ( object instanceof View ) {
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
            return;
        }
        event.preventDefault();
    }.on( 'keydown' ),
});

var toView = function ( name ) {
    return ( name === '-' ) ? Element$1.create( 'span.v-Toolbar-divider' ) :
        ( name === '*' ) ? null :
        this._views[ name ];
};

var OverflowMenuView = Class({

    Extends: MenuButtonView,

    didEnterDocument: function didEnterDocument () {
        OverflowMenuView.parent.didEnterDocument.call( this );
        this.setShortcuts( null, '', {}, this.get( 'shortcuts' ) );
        return this;
    },

    willLeaveDocument: function willLeaveDocument () {
        this.setShortcuts( null, '', this.get( 'shortcuts' ), {} );
        return OverflowMenuView.parent.willLeaveDocument.call( this );
    },

    shortcuts: function () {
        var views = this.getFromPath( 'menuView.options' );
        return views ? views.reduce( function ( acc, view ) {
            var shortcut = view.get( 'shortcut' );
            if ( shortcut ) {
                shortcut.split( ' ' ).forEach( function (key) {
                    acc[ key ] = view;
                });
            }
            return acc;
        }, {} ) : {};
    }.property( 'menuView' ),

    setShortcuts: function ( _, __, oldShortcuts, shortcuts ) {
        var this$1 = this;

        if ( this.get( 'isInDocument' ) ) {
            var kbShortcuts = ViewEventsController.kbShortcuts;
            if ( !shortcuts ) {
                shortcuts = this.get( 'shortcuts' );
            }
            for ( var key in oldShortcuts ) {
                kbShortcuts.deregister( key, this$1, 'activateButton' );
            }
            for ( var key$1 in shortcuts ) {
                kbShortcuts.register( key$1, this$1, 'activateButton' );
            }
        }
    }.observes( 'shortcuts' ),

    activateButton: function activateButton ( event ) {
        var key = lookupKey( event );
        var button = this.get( 'shortcuts' )[ key ];
        if ( button instanceof MenuButtonView ) {
            this.activate();
        }
        button.activate();
    },
});

var viewIsBeforeFlex = function ( view, flex ) {
    var layer = view.get( 'layer' );
    var childNodes = flex.parentNode.childNodes;
    var l = childNodes.length;
    var node;
    while ( l-- ) {
        node = childNodes[l];
        if ( node === layer ) {
            return false;
        }
        if ( node === flex ) {
            return true;
        }
    }
    return true;
};

var ToolbarView = Class({

    Extends: View,

    className: 'v-Toolbar',

    config: 'standard',
    minimumGap: 20,
    preventOverlap: false,
    popOverOptions: null,

    init: function init (/* ...mixins */) {
        ToolbarView.parent.constructor.apply( this, arguments );
        this._views = {
            overflow: new OverflowMenuView({
                label: loc( 'More' ),
                shortcut: '.',
                popOverView: this.popOverView || new PopOverView(),
                popOverOptions: this.get( 'popOverOptions' ),
            }),
        };
        this._configs = {
            standard: {
                left: [],
                right: [],
            },
        };
        this._measureView = null;
        this._widths = {};
        this._flex = null;
    },

    registerView: function registerView ( name, view, _dontMeasure ) {
        this._views[ name ] = view;
        if ( !_dontMeasure && this.get( 'isInDocument' ) &&
                this.get( 'preventOverlap' ) ) {
            this.preMeasure().postMeasure();
        }
        return this;
    },

    registerViews: function registerViews ( views ) {
        var this$1 = this;

        for ( var name in views ) {
            this$1.registerView( name, views[ name ], true );
        }
        if ( this.get( 'isInDocument' ) && this.get( 'preventOverlap' ) ) {
            this.preMeasure().postMeasure();
        }
        return this;
    },

    registerConfig: function registerConfig ( name, config ) {
        this._configs[ name ] = config;
        if ( this.get( 'config' ) === name ) {
            this.computedPropertyDidChange( 'config' );
        }
        return this;
    },

    registerConfigs: function registerConfigs ( configs ) {
        var this$1 = this;

        for ( var name in configs ) {
            this$1.registerConfig( name, configs[ name ] );
        }
        return this;
    },

    getView: function getView ( name ) {
        return this._views[ name ];
    },

    getConfig: function getConfig ( config ) {
        return this._configs[ config ] || null;
    },

    // ---

    leftConfig: function () {
        var configs = this._configs;
        var config = configs[ this.get( 'config' ) ];
        return ( config && config.left ) || configs.standard.left;
    }.property( 'config' ),

    rightConfig: function () {
        var configs = this._configs;
        var config = configs[ this.get( 'config' ) ];
        return ( config && config.right ) || configs.standard.right;
    }.property( 'config' ),

    left: function () {
        var leftConfig = this.get( 'leftConfig' );
        if ( this.get( 'preventOverlap' ) ) {
            var rightConfig = this.get( 'rightConfig' );
            var widths = this._widths;
            var pxWidth = this.get( 'pxWidth' );
            var rootView, i, l, config;
            if ( !pxWidth ) {
                rootView = this.getParent( RootView );
                pxWidth = rootView ? rootView.get( 'pxWidth' ) : 1024;
            }
            pxWidth -= this.get( 'minimumGap' );
            for ( i = 0, l = rightConfig.length; i < l; i += 1 ) {
                pxWidth -= widths[ rightConfig[i] ];
            }
            for ( i = 0, l = leftConfig.length; i < l; i += 1 ) {
                config = leftConfig[i];
                if ( config === '*' ) {
                    break;
                } else {
                    pxWidth -= widths[ config ];
                }
            }
            if ( pxWidth < 0 || i < l ) {
                pxWidth -= widths[ '-' ];
                pxWidth -= widths.overflow;

                while ( pxWidth < 0 && i-- ) {
                    pxWidth += widths[ leftConfig[i] ];
                }

                if ( i < 0 ) {
                    i = 0;
                }

                this._views.overflow.set( 'menuView', new MenuView({
                    showFilter: false,
                    options: leftConfig.slice( i )
                        .map( toView, this )
                        .filter( function (view) { return view instanceof View; } ),
                }));

                if ( i > 0 ) {
                    if ( leftConfig[ i - 1 ] === '-' ) {
                        i -= 1;
                    }
                    leftConfig = leftConfig.slice( 0, i );
                    leftConfig.push( '-' );
                    leftConfig.push( 'overflow' );
                } else {
                    leftConfig = [ 'overflow' ];
                }
            }
        }
        return leftConfig.map( toView, this );
    }.property( 'leftConfig', 'rightConfig', 'pxWidth' ),

    right: function () {
        return this.get( 'rightConfig' ).map( toView, this );
    }.property( 'rightConfig' ),

    preMeasure: function preMeasure () {
        this.insertView( this._measureView =
            new View({
                className: 'v-Toolbar-measure',
                layerStyles: {},
                childViews: Object.values( this._views )
                                  .filter( function (view) { return !view.get( 'parentView' ); } ),
                draw: function draw ( layer, Element, el ) {
                    return [
                        el( 'span.v-Toolbar-divider' ),
                        View.prototype.draw.call( this, layer, Element, el ) ];
                },
            })
        );
        return this;
    },

    postMeasure: function postMeasure () {
        var widths = this._widths;
        var views = this._views;
        var measureView = this._measureView;
        var unused = measureView.get( 'childViews' );
        var container = measureView.get( 'layer' );
        var containerBoundingClientRect = container.getBoundingClientRect();
        var firstButton = unused.length ? unused[0].get( 'layer' ) : null;

        for ( var name in views ) {
            widths[ name ] = views[ name ].get( 'pxWidth' ) || widths[ name ];
        }

        // Want to include any left/right margin, so get difference between
        // edge of first button and start of container
        widths[ '-' ] = ( firstButton ?
            firstButton.getBoundingClientRect().left :
            containerBoundingClientRect.right
        ) - containerBoundingClientRect.left;

        this.removeView( measureView );
        var l = unused.length;
        while ( l-- ) {
            measureView.removeView( unused[l] );
        }
        measureView.destroy();
        this._measureView = null;

        return this;
    },

    willEnterDocument: function willEnterDocument () {
        ToolbarView.parent.willEnterDocument.call( this );
        if ( this.get( 'preventOverlap' ) ) {
            this.preMeasure();
        }
        return this;
    },

    didEnterDocument: function didEnterDocument () {
        ToolbarView.parent.didEnterDocument.call( this );
        if ( this.get( 'preventOverlap' ) ) {
            this.postMeasure();
        }
        return this;
    },

    draw: function draw ( layer, Element, el ) {
        return [
            this.get( 'left' ),
            this._flex = el( 'div.v-Toolbar-flex' ),
            this.get( 'right' ) ];
    },

    toolbarNeedsRedraw: function ( self, property, oldValue ) {
        if ( oldValue ) {
            this.propertyNeedsRedraw( self, property, oldValue );
        }
    }.observes( 'left', 'right' ),

    redrawLeft: function redrawLeft ( layer, oldViews ) {
        this.redrawSide( layer, true, oldViews, this.get( 'left' ) );
    },
    redrawRight: function redrawRight ( layer, oldViews ) {
        this.redrawSide( layer, false, oldViews, this.get( 'right' ) );
    },

    redrawSide: function redrawSide ( layer, isLeft, oldViews, newViews ) {
        var this$1 = this;

        var start = 0;
        var isEqual$$1 = true;
        var flex = this._flex;
        var i, l, view, parent;

        for ( i = start, l = oldViews.length; i < l; i += 1 ) {
            view = oldViews[i];
            if ( view instanceof View ) {
                if ( isEqual$$1 && view === newViews[i] ) {
                    start += 1;
                } else {
                    isEqual$$1 = false;
                    // Check it hasn't already swapped sides!
                    if ( viewIsBeforeFlex( view, flex ) === isLeft ) {
                        this$1.removeView( view );
                    }
                }
            } else {
                if ( isEqual$$1 && !( newViews[i] instanceof View ) ) {
                    start += 1;
                    newViews[i] = view;
                } else {
                    layer.removeChild( view );
                }
            }
        }
        for ( i = start, l = newViews.length; i < l; i += 1 ) {
            view = newViews[i];
            if ( view instanceof View ) {
                if (( parent = view.get( 'parentView' ) )) {
                    parent.removeView( view );
                }
                this$1.insertView( view,
                    isLeft ? flex : layer,
                    isLeft ? 'before' : 'bottom' );
            } else if ( view ) {
                layer.insertBefore( view, isLeft ? flex : null );
            }
        }
    },
});

ToolbarView.OverflowMenuView = OverflowMenuView;

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

        <button>
            <input type="file">
            ${view.icon}
            <span class="label">${view.label}</span>
        </button>

*/
var FileButtonView = Class({

    Extends: ButtonView,

    /**
        Property: O.FileButtonView#acceptMultiple
        Type: Boolean
        Default: false

        Should the user be allowed to select multiple files at once?
    */
    acceptMultiple: false,

    /**
        Property: O.FileButtonView#acceptFolder
        Type: Boolean
        Default: false

        Should the user be allowed to select a folder to upload instead of
        individual files (if the browser supports it)?
    */
    acceptFolder: false,

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
    draw: function draw ( layer, Element, el ) {
        var icon = this.get( 'icon' );
        if ( typeof icon === 'string' ) {
            icon = ButtonView.drawIcon( icon );
        } else if ( !icon ) {
            icon = document.createComment( 'icon' );
        }
        return [
            this._domControl = el( 'input', {
                className: 'v-FileButton-input',
                type: 'file',
                accept: this.get( 'acceptOnlyTypes' ) || undefined,
                multiple: this.get( 'acceptMultiple' ),
                webkitdirectory: this.get( 'acceptFolder' ) || undefined,
            }),
            icon,
            AbstractControlView.prototype.draw
                .call( this, layer, Element, el ) ];
    },

    // --- Activate ---

    /**
        Method: O.FileButtonView#activate

        Opens the OS file chooser dialog.
    */
    activate: function activate () {
        this._setIgnoreUntil();
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
        var input = this._domControl;
        var files = Array.prototype.slice.call( input.files );

        if ( event.target === input && files.length ) {
            var target, action;
            if ( !this.get( 'isDisabled' ) ) {
                target = this.get( 'target' ) || this;
                if (( action = this.get( 'action' ) )) {
                    target.fire( action, {
                        originView: this,
                        files: files,
                    });
                } else if (( action = this.get( 'method' ) )) {
                    target[ action ]( files, this );
                }
            }
        }
        input.value = '';
        this.fire( 'button:activate' );
    }.on( 'change' ),
});

/*global window, document, FileReader, Squire */

// and Function#queue
var execCommand = function ( command ) {
    return function ( arg ) {
        var editor = this.get( 'editor' );
        if ( editor ) {
            editor[ command ]( arg );
        }
        return this;
    };
};

var queryCommandState = function ( tag ) {
    var regexp = new RegExp( '(?:^|>)' + tag + '\\b' );
    return function () {
        var path = this.get( 'path' );
        return path === '(selection)' ?
            this.get( 'editor' ).hasFormat( tag ) :
            regexp.test( path );
    }.property( 'path' );
};

var emailRegExp = RegExp.email;
// Use a more relaxed definition of a URL than normal; anything URL-like we
// want to accept so we can prefill the link destination box.
var urlRegExp =
    /^(?:https?:\/\/)?[\w.]+[.][a-z]{2,4}(?:\/[^\s()<>]+|\([^\s()<>]+\))*/i;

var popOver = new PopOverView();

var equalTo = Transform.isEqualToValue;

var TOOLBAR_HIDDEN = 0;
var TOOLBAR_INLINE = 1;
var TOOLBAR_AT_SELECTION = 2;
var TOOLBAR_AT_TOP = 3;

var hiddenFloatingToolbarLayout = {
    top: 0,
    left: 0,
    maxWidth: '100%',
    transform: 'translate3d(-100vw,0,0)',
};

var URLPickerView = Class({

    Extends: View,

    prompt: '',
    placeholder: '',
    confirm: '',

    value: '',

    className: 'v-UrlPicker',

    draw: function draw ( layer, Element, el ) {
        return [
            el( 'h3.u-bold', [
                this.get( 'prompt' ) ]),
            this._input = new TextView({
                value: bindTwoWay( this, 'value' ),
                placeholder: this.get( 'placeholder' ),
            }),
            el( 'p.u-alignRight', [
                new ButtonView({
                    type: 'v-Button--destructive v-Button--size13',
                    label: loc( 'Cancel' ),
                    target: popOver,
                    method: 'hide',
                }),
                new ButtonView({
                    type: 'v-Button--constructive v-Button--size13',
                    label: this.get( 'confirm' ),
                    target: this,
                    method: 'add',
                }) ]) ];
    },

    // ---

    autoFocus: function () {
        if ( this.get( 'isInDocument' ) ) {
            this._input.set( 'selection', {
                start: 0,
                end: this.get( 'value' ).length,
            }).focus();
            // IE8 and Safari 6 don't fire this event for some reason.
            this._input.fire( 'focus' );
        }
    }.nextFrame().observes( 'isInDocument' ),

    addOnEnter: function ( event ) {
        if ( lookupKey( event ) === 'Enter' ) {
            this.add();
        }
    }.on( 'keyup' ),
});

var RichTextView = Class({

    Extends: View,

    Mixin: DropTarget,

    isFocused: false,
    isDisabled: false,
    tabIndex: undefined,
    label: undefined,

    // ---

    savedSelection: null,
    isTextSelected: false,

    setIsTextSelected: function ( event ) {
        this.set( 'isTextSelected', event.type === 'select' );
    }.on( 'cursor', 'select' ),

    // ---

    showToolbar: UA.isIOS ? TOOLBAR_AT_SELECTION : TOOLBAR_AT_TOP,
    fontFaceOptions: function () {
        return [
            [ loc( 'Default' ), null ],
            [ 'Arial', 'arial, sans-serif' ],
            [ 'Georgia', 'georgia, serif' ],
            [ 'Helvetica', 'helvetica, arial, sans-serif' ],
            [ 'Monospace', 'menlo, consolas, monospace' ],
            [ 'Tahoma', 'tahoma, sans-serif' ],
            [ 'Times New Roman', '"Times New Roman", times, serif' ],
            [ 'Trebuchet MS', '"Trebuchet MS", sans-serif' ],
            [ 'Verdana', 'verdana, sans-serif' ] ];
    }.property(),

    fontSizeOptions: function () {
        return [
            [ loc( 'Small' ), '10px' ],
            [ loc( 'Medium' ), null  ],
            [ loc( 'Large' ), '16px' ],
            [ loc( 'Huge' ),  '22px' ] ];
    }.property(),

    editor: null,
    editorId: undefined,
    editorClassName: '',
    styles: null,
    blockDefaults: null,

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

    destroy: function destroy () {
        var editor = this.get( 'editor' );
        if ( editor ) {
            editor.destroy();
        }
        RichTextView.parent.destroy.call( this );
    },

    // --- Render ---

    willEnterDocument: function willEnterDocument () {
        this.set( 'path', '' );
        RichTextView.parent.willEnterDocument.call( this );
        this.get( 'layer' ).appendChild( this._editingLayer );
        return this;
    },

    didEnterDocument: function didEnterDocument () {
        RichTextView.parent.didEnterDocument.call( this );

        var selection = this.get( 'savedSelection' );
        var editor = this.get( 'editor' );
        if ( selection ) {
            editor.setSelection(
                editor.createRange(
                    selection.sc, selection.so,
                    selection.ec, selection.eo
                )
            ).focus();
            this.set( 'savedSelection', null );
        } else {
            editor.moveCursorToStart();
        }

        var scrollView = this.getParent( ScrollView );
        if ( scrollView && this.get( 'showToolbar' ) === TOOLBAR_AT_TOP ) {
            scrollView.addObserverForKey(
                'scrollTop', this, '_calcToolbarPosition' );
            // Need to queue rather than call immediately because the toolbar
            // will be in the rich text view and if we need to make it sticky
            // we need to shift it round. But we're in the middle of the
            // will/did enter callbacks, so we might end up in an inconsistent
            // state.
            RunLoop.queueFn( 'after', this._calcToolbarPosition.bind( this,
                scrollView, '', 0, scrollView.get( 'scrollTop' ) ) );
        }

        return this;
    },

    willLeaveDocument: function willLeaveDocument () {
        var scrollView = this.getParent( ScrollView );
        if ( scrollView && this.get( 'showToolbar' ) === TOOLBAR_AT_TOP ) {
            scrollView.removeObserverForKey(
                'scrollTop', this, '_calcToolbarPosition' );
            this._setToolbarPosition(
                scrollView, this.get( 'toolbarView' ), false );
        }

        // If focused, save cursor position
        if ( this.get( 'isFocused' ) ) {
            var selection = this.get( 'editor' ).getSelection();
            this.set( 'savedSelection', {
                sc: selection.startContainer,
                so: selection.startOffset,
                ec: selection.endContainer,
                eo: selection.endOffset,
            });
            this.blur();
        }

        return RichTextView.parent.willLeaveDocument.call( this );
    },

    didLeaveDocument: function didLeaveDocument () {
        // The nodes must be in a document or document fragment for DOM Range
        // API to work; otherwise will throw INVALID_NODE_TYPE_ERR errors.
        // This is important if the value is changed before appending.
        document.createDocumentFragment().appendChild( this._editingLayer );
        return RichTextView.parent.didLeaveDocument.call( this );
    },

    // ---

    className: function () {
        return 'v-RichText' +
            ( this.get( 'isFocused' ) ? ' is-focused' : '' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' ) +
            ( this.get( 'showToolbar' ) === TOOLBAR_HIDDEN ?
                ' v-RichText--noToolbar' : '' );
    }.property( 'isFocused', 'isDisabled' ),

    draw: function draw ( layer, Element, el ) {
        var editorClassName = this.get( 'editorClassName' );
        var editingLayer = this._editingLayer = el( 'div', {
            id: this.get( 'editorId' ),
            'role': 'textbox',
            'aria-multiline': 'true',
            'aria-label': this.get( 'label' ),
            tabIndex: this.get( 'tabIndex' ),
            className: 'v-RichText-input' +
                ( editorClassName ? ' ' + editorClassName : '' ),
        });
        // The nodes must be in a document or document fragment for DOM Range
        // API to work; otherwise will throw INVALID_NODE_TYPE_ERR errors.
        document.createDocumentFragment().appendChild( editingLayer );
        var editor = new Squire( editingLayer, this.get( 'blockDefaults' ) );
        editor
            .setHTML( this._value )
            .addEventListener( 'input', this )
            .addEventListener( 'select', this )
            .addEventListener( 'cursor', this )
            .addEventListener( 'pathChange', this )
            .addEventListener( 'undoStateChange', this )
            .addEventListener( 'dragover', this )
            .addEventListener( 'drop', this )
            .didError = RunLoop.didError;
        this.set( 'editor', editor )
            .set( 'path', editor.getPath() );

        if ( this.get( 'isDisabled' ) ) {
            this.redrawIsDisabled();
        }

        return [
            el( 'style', { type: 'text/css' }, [
                this.get( 'styles' ) ]),
            this.get( 'showToolbar' ) !== TOOLBAR_HIDDEN ?
                this.get( 'toolbarView' ) :
                null ];
    },

    viewNeedsRedraw: function ( self, property, oldValue ) {
        this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'isDisabled', 'tabIndex' ),

    redrawIsDisabled: function redrawIsDisabled () {
        this._editingLayer.setAttribute( 'contenteditable',
            this.get( 'isDisabled' )  ? 'false' : 'true'
        );
    },

    redrawTabIndex: function redrawTabIndex () {
        this._editingLayer.set( 'tabIndex', this.get( 'tabIndex' ) );
    },

    // ---

    scrollIntoView: function () {
        if ( !this.get( 'isFocused' ) ) {
            return;
        }

        var scrollView = this.getParent( ScrollView );
        if ( !scrollView ) {
            return;
        }

        var editor = this.get( 'editor' );
        var cursorPosition = editor && editor.getCursorPosition();
        if ( !cursorPosition ) {
            return;
        }

        var scrollViewOffsetTop =
            scrollView.get( 'layer' ).getBoundingClientRect().top;
        var offsetTop = cursorPosition.top - scrollViewOffsetTop;
        var offsetBottom = cursorPosition.bottom - scrollViewOffsetTop;
        var scrollViewHeight = scrollView.get( 'pxHeight' );
        var scrollBy = 0;
        if ( UA.isIOS ) {
            scrollViewHeight -=
                // Keyboard height (in WKWebView, but not Safari)
                ( document.body.offsetHeight - window.innerHeight );
        }
        if ( offsetTop - 15 < 0 ) {
            scrollBy = offsetTop - 15;
        } else if ( offsetBottom + 15 > scrollViewHeight ) {
            scrollBy = offsetBottom + 15 - scrollViewHeight;
        }
        if ( scrollBy ) {
            scrollView.scrollBy( 0, Math.round( scrollBy ), true );
        }
    }.queue( 'after' ).on( 'cursor' ),

    _calcToolbarPosition: function _calcToolbarPosition ( scrollView, _, __, scrollTop ) {
        var toolbarView = this.get( 'toolbarView' );
        var offsetHeight = this._offsetHeight;
        var offsetTop = this._offsetTop;
        var now = Date.now();
        var wasSticky = toolbarView.get( 'parentView' ) !== this;

        // For performance, cache the size and position for 1/2 second from last
        // use.
        if ( !offsetTop || this._offsetExpiry < now ) {
            this._offsetHeight = offsetHeight =
                this.get( 'layer' ).offsetHeight;
            this._offsetTop = offsetTop =
                Math.floor( this.getPositionRelativeTo( scrollView ).top );
        }
        this._offsetExpiry = now + 500;

        var isSticky =
            scrollTop > offsetTop &&
            scrollTop < offsetTop + offsetHeight -
                ( scrollView.get( 'pxHeight' ) >> 2 );

        if ( isSticky !== wasSticky ) {
            this._setToolbarPosition( scrollView, toolbarView, isSticky );
        }
    },

    _setToolbarPosition: function _setToolbarPosition ( scrollView, toolbarView, isSticky ) {
        if ( isSticky ) {
            var newParent = scrollView.get( 'parentView' );
            var position = toolbarView.getPositionRelativeTo( newParent );
            // Need to account separately for any border in the new parent.
            var borders = scrollView.getPositionRelativeTo( newParent );
            toolbarView
                .set( 'layout', {
                    top: scrollView.get( 'pxTop' ),
                    left: position.left - borders.left,
                    width: toolbarView.get( 'pxWidth' ),
                });
            newParent.insertView( toolbarView );
        } else {
            toolbarView
                .set( 'layout', {
                    top: 0,
                    left: 0,
                    right: 0,
                });
            this.insertView( toolbarView, null, 'top' );
        }
    },

    // ---

    floatingToolbarLayout: hiddenFloatingToolbarLayout,

    hideFloatingToolbar: function () {
        this.set( 'floatingToolbarLayout', hiddenFloatingToolbarLayout );
    }.on( 'cursor' ),

    showFloatingToolbar: function showFloatingToolbar () {
        if ( this.get( 'showToolbar' ) !== TOOLBAR_AT_SELECTION ) {
            return;
        }
        var range = this.get( 'editor' ).getSelection();
        var node = UA.isIOS ? range.endContainer : range.startContainer;
        if ( node.nodeType !== 1 /* Node.ELEMENT_NODE */ ) {
            node = node.parentNode;
        }
        var position = Element$1.getPosition( node, this.get( 'layer' ) );
        this.set( 'floatingToolbarLayout', {
            top: 0,
            left: 0,
            maxWidth: '100%',
            transform: 'translate3d(0,' + (
                UA.isIOS ?
                position.top + position.height + 10 :
                position.top -
                    this.get( 'toolbarView' ).get( 'pxHeight' ) - 10
            ) + 'px,0)',
        });
    },

    showFloatingToolbarIfSelection: function () {
        var toolbarIsVisible =
                this.get( 'floatingToolbarLayout' ) !==
                    hiddenFloatingToolbarLayout;
        if ( !toolbarIsVisible && this.get( 'isTextSelected' ) ) {
            this.showFloatingToolbar();
        }
    // (You might think 'select' was the right event to hook onto, but that
    // causes trouble as it shows the toolbar while the mouse is still down,
    // which gets in the way of the selection. So mouseup it is.)
    }.on( 'mouseup', 'keyup' ),

    // ---

    toolbarConfig: {
        left: [
            'bold', 'italic', 'underline', 'strikethrough', '-',
            'font', 'size', '-',
            'color', 'bgcolor', '-',
            'image', '-',
            'link', '-',
            'ul', 'ol', '-',
            'quote', 'unquote', '-',
            'left', 'centre', 'right', 'justify', '-',
            'ltr', 'rtl', '-',
            'unformat' ],
        right: [],
    },

    toolbarView: function () {
        var richTextView = this;
        var showToolbar = this.get( 'showToolbar' );

        return new ToolbarView({
            className: 'v-Toolbar v-RichText-toolbar',
            positioning: 'absolute',
            layout: showToolbar === TOOLBAR_AT_SELECTION ?
                bind( this, 'floatingToolbarLayout' ) :
                {
                    overflow: 'hidden',
                    zIndex: 1,
                    top: 0,
                    left: 0,
                    right: 0,
                },
            preventOverlap: showToolbar === TOOLBAR_AT_TOP,
        }).registerViews({
            bold: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-bold',
                isActive: bind( this, 'isBold' ),
                label: loc( 'Bold' ),
                tooltip: loc( 'Bold' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-b' ),
                activate: function activate () {
                    if ( richTextView.get( 'isBold' ) ) {
                        richTextView.removeBold();
                    } else {
                        richTextView.bold();
                    }
                    this.fire( 'button:activate' );
                },
            }),
            italic: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-italic',
                isActive: bind( this, 'isItalic' ),
                label: loc( 'Italic' ),
                tooltip: loc( 'Italic' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-i' ),
                activate: function activate () {
                    if ( richTextView.get( 'isItalic' ) ) {
                        richTextView.removeItalic();
                    } else {
                        richTextView.italic();
                    }
                    this.fire( 'button:activate' );
                },
            }),
            underline: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-underline',
                isActive: bind( this, 'isUnderlined' ),
                label: loc( 'Underline' ),
                tooltip: loc( 'Underline' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-u' ),
                activate: function activate () {
                    if ( richTextView.get( 'isUnderlined' ) ) {
                        richTextView.removeUnderline();
                    } else {
                        richTextView.underline();
                    }
                    this.fire( 'button:activate' );
                },
            }),
            strikethrough: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-strikethrough',
                isActive: bind( this, 'isStriked' ),
                label: loc( 'Strikethrough' ),
                tooltip: loc( 'Strikethrough' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-Shift-7' ),
                activate: function activate () {
                    if ( richTextView.get( 'isStriked' ) ) {
                        richTextView.removeStrikethrough();
                    } else {
                        richTextView.strikethrough();
                    }
                    this.fire( 'button:activate' );
                },
            }),
            size: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-font-size',
                label: loc( 'Font Size' ),
                tooltip: loc( 'Font Size' ),
                target: this,
                method: 'showFontSizeMenu',
            }),
            font: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-font',
                label: loc( 'Font Face' ),
                tooltip: loc( 'Font Face' ),
                target: this,
                method: 'showFontFaceMenu',
            }),
            color: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-palette',
                label: loc( 'Text Color' ),
                tooltip: loc( 'Text Color' ),
                target: this,
                method: 'showTextColorMenu',
            }),
            bgcolor: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-highlight',
                label: loc( 'Text Highlight' ),
                tooltip: loc( 'Text Highlight' ),
                target: this,
                method: 'showTextHighlightColorMenu',
            }),
            link: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-link',
                isActive: bind( this, 'isLink' ),
                label: loc( 'Link' ),
                tooltip: loc( 'Link' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-k' ),
                activate: function activate () {
                    if ( richTextView.get( 'isLink' ) ) {
                        richTextView.removeLink();
                    } else {
                        richTextView.showLinkOverlay( this );
                    }
                    this.fire( 'button:activate' );
                },
            }),
            code: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-code',
                isActive: bind( this, 'isCode' ),
                label: loc( 'Preformatted Text' ),
                tooltip: loc( 'Preformatted Text' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-d' ),
                activate: function activate () {
                    if ( richTextView.get( 'isCode' ) ) {
                        richTextView.removeCode();
                    } else {
                        richTextView.code();
                    }
                    this.fire( 'button:activate' );
                },
            }),
            image: new FileButtonView({
                tabIndex: -1,
                type: 'v-FileButton v-Button--iconOnly',
                icon: 'icon-image',
                label: loc( 'Insert Image' ),
                tooltip: loc( 'Insert Image' ),
                acceptMultiple: true,
                acceptOnlyTypes: 'image/jpeg, image/png, image/gif',
                target: this,
                method: 'insertImagesFromFiles',
            }),
            remoteImage: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-image',
                label: loc( 'Insert Image' ),
                tooltip: loc( 'Insert Image' ),
                target: this,
                method: 'showInsertImageOverlay',
            }),
            left: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-left',
                isActive: bind( this, 'alignment', equalTo( 'left' ) ),
                label: loc( 'Left' ),
                tooltip: loc( 'Left' ),
                activate: function activate () {
                    richTextView.setTextAlignment( 'left' );
                    this.fire( 'button:activate' );
                },
            }),
            centre: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-centre',
                isActive: bind( this, 'alignment', equalTo( 'center' ) ),
                label: loc( 'Center' ),
                tooltip: loc( 'Center' ),
                activate: function activate () {
                    richTextView.setTextAlignment( 'center' );
                    this.fire( 'button:activate' );
                },
            }),
            right: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-right',
                isActive: bind( this, 'alignment', equalTo( 'right' ) ),
                label: loc( 'Right' ),
                tooltip: loc( 'Right' ),
                activate: function activate () {
                    richTextView.setTextAlignment( 'right' );
                    this.fire( 'button:activate' );
                },
            }),
            justify: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-paragraph-justify',
                isActive: bind( this, 'alignment', equalTo( 'justify' ) ),
                label: loc( 'Justify' ),
                tooltip: loc( 'Justify' ),
                activate: function activate () {
                    richTextView.setTextAlignment( 'justify' );
                    this.fire( 'button:activate' );
                },
            }),
            ltr: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-lefttoright',
                isActive: bind( this, 'direction', equalTo( 'ltr' ) ),
                label: loc( 'Text Direction: Left to Right' ),
                tooltip: loc( 'Text Direction: Left to Right' ),
                activate: function activate () {
                    richTextView.setTextDirection( 'ltr' );
                    this.fire( 'button:activate' );
                },
            }),
            rtl: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-righttoleft',
                isActive: bind( this, 'direction', equalTo( 'rtl' ) ),
                label: loc( 'Text Direction: Right to Left' ),
                tooltip: loc( 'Text Direction: Right to Left' ),
                activate: function activate () {
                    richTextView.setTextDirection( 'rtl' );
                    this.fire( 'button:activate' );
                },
            }),
            quote: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-quotes-left',
                label: loc( 'Quote' ),
                tooltip: loc( 'Quote' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-]' ),
                target: richTextView,
                method: 'increaseQuoteLevel',
            }),
            unquote: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-quotes-right',
                label: loc( 'Unquote' ),
                tooltip: loc( 'Unquote' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-[' ),
                target: richTextView,
                method: 'decreaseQuoteLevel',
            }),
            ul: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-list',
                isActive: bind( this, 'isUnorderedList' ),
                label: loc( 'Unordered List' ),
                tooltip: loc( 'Unordered List' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-Shift-8' ),
                activate: function activate () {
                    if ( richTextView.get( 'isUnorderedList' ) ) {
                        richTextView.removeList();
                    } else {
                        richTextView.makeUnorderedList();
                    }
                    this.fire( 'button:activate' );
                },
            }),
            ol: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-numbered-list',
                isActive: bind( this, 'isOrderedList' ),
                label: loc( 'Ordered List' ),
                tooltip: loc( 'Ordered List' ) + '\n' +
                    formatKeyForPlatform( 'Cmd-Shift-9' ),
                activate: function activate () {
                    if ( richTextView.get( 'isOrderedList' ) ) {
                        richTextView.removeList();
                    } else {
                        richTextView.makeOrderedList();
                    }
                    this.fire( 'button:activate' );
                },
            }),
            unformat: new ButtonView({
                tabIndex: -1,
                type: 'v-Button--iconOnly',
                icon: 'icon-clear-formatting',
                label: loc( 'Clear Formatting' ),
                tooltip: loc( 'Clear Formatting' ),
                activate: function activate () {
                    richTextView.removeAllFormatting();
                    this.fire( 'button:activate' );
                },
            }),
        }).registerConfig( 'standard', this.get( 'toolbarConfig' ) );
    }.property(),

    fontSizeMenuView: function () {
        var richTextView = this;
        return new MenuView({
            showFilter: false,
            options: this.get( 'fontSizeOptions' ).map(
                function (ref) {
                    var label = ref[0];
                    var fontSize = ref[1];

                    return new ButtonView({
                    layout: fontSize ? {
                        fontSize: fontSize,
                    } : null,
                    label: label,
                    method: 'setFontSize',
                    setFontSize: function setFontSize () {
                        richTextView.setFontSize( fontSize );
                    },
                });
        }
            ),
        });
    }.property(),

    showFontSizeMenu: function showFontSizeMenu ( buttonView ) {
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'fontSizeMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2,
        });
    },

    fontFaceMenuView: function () {
        var richTextView = this;
        return new MenuView({
            showFilter: false,
            options: this.get( 'fontFaceOptions' ).map(
                function (ref) {
                    var label = ref[0];
                    var fontFace = ref[1];

                    return new ButtonView({
                    layout: fontFace ? {
                        fontFamily: fontFace,
                    } : null,
                    label: label,
                    method: 'setFontFace',
                    setFontFace: function setFontFace () {
                        richTextView.setFontFace( fontFace );
                    },
                });
        }
            ),
        });
    }.property(),

    showFontFaceMenu: function showFontFaceMenu ( buttonView ) {
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'fontFaceMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2,
        });
    },

    _colorText: true,

    textColorMenuView: function () {
        var richTextView = this;
        return new MenuView({
            className: 'v-ColorMenu',
            showFilter: false,
            options: [
                    '#000000', '#b22222', '#ff0000', '#ffa07a', '#fff0f5',
                    '#800000', '#a52a2a', '#ff8c00', '#ffa500', '#faebd7',
                    '#8b4513', '#daa520', '#ffd700', '#ffff00', '#ffffe0',
                    '#2f4f4f', '#006400', '#008000', '#00ff00', '#f0fff0',
                    '#008080', '#40e0d0', '#00ffff', '#afeeee', '#f0ffff',
                    '#000080', '#0000cd', '#0000ff', '#add8e6', '#f0f8ff',
                    '#4b0082', '#800080', '#ee82ee', '#dda0dd', '#e6e6fa',
                    '#696969', '#808080', '#a9a9a9', '#d3d3d3', '#ffffff' ].map( function (color) { return new ButtonView({
                    layout: {
                        backgroundColor: color,
                    },
                    label: color,
                    method: 'setColor',
                    setColor: function setColor () {
                        if ( richTextView._colorText ) {
                            richTextView.setTextColor( color );
                        } else {
                            richTextView.setHighlightColor( color );
                        }
                    },
                }); }),
        });
    }.property(),

    showTextColorMenu: function showTextColorMenu ( buttonView ) {
        this._colorText = true;
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'textColorMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2,
        });
    },

    showTextHighlightColorMenu: function showTextHighlightColorMenu ( buttonView ) {
        this._colorText = false;
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        popOver.show({
            view: this.get( 'textColorMenuView' ),
            alignWithView: buttonView,
            alignEdge: 'centre',
            showCallout: true,
            offsetTop: 2,
        });
    },

    linkOverlayView: function () {
        var richTextView = this;
        return new URLPickerView({
            prompt: loc( 'Add a link to the following URL or email:' ),
            placeholder: 'e.g. www.example.com',
            confirm: loc( 'Add Link' ),
            add: function add () {
                var url = this.get( 'value' ).trim();
                var email;
                // Don't allow malicious links
                if ( /^(?:javascript|data):/i.test( url ) ) {
                    return;
                }
                // If it appears to start with a url protocol,
                // pass it through verbatim.
                if ( !( /[a-z][\w-]+:/i.test( url ) ) ) {
                    // Otherwise, look for an email address,
                    // and add a mailto: handler, if found.
                    email = emailRegExp.exec( url );
                    if ( email ) {
                        url = 'mailto:' + email[0];
                    // Or an http:// prefix if not.
                    } else {
                        url = 'http://' + url;
                    }
                }
                richTextView.makeLink( url );
                popOver.hide();
            },
        });
    }.property(),

    showLinkOverlay: function showLinkOverlay ( buttonView ) {
        var view = this.get( 'linkOverlayView' );
        var value = this.getSelectedText().trim();
        if ( !urlRegExp.test( value ) && !emailRegExp.test( value ) ) {
            value = '';
        }
        view.set( 'value', value );
        this.showOverlay( view, buttonView );
    },

    insertImageOverlayView: function () {
        var richTextView = this;
        return new URLPickerView({
            prompt: loc( 'Insert an image from the following URL:' ),
            placeholder: 'e.g. https://example.com/path/to/image.jpg',
            confirm: loc( 'Insert Image' ),
            add: function add () {
                var url = this.get( 'value' ).trim();
                if ( !/^https?:/i.test( url ) ) {
                    // Must be http/https protocol
                    if ( /^[a-z]:/i.test( url ) ) {
                        return;
                    }
                    // If none, presume http
                    url = 'http://' + url;
                }
                richTextView.insertImage( url );
                popOver.hide();
            },
        });
    }.property(),

    showInsertImageOverlay: function showInsertImageOverlay ( buttonView ) {
        var view = this.get( 'insertImageOverlayView' );
        view.set( 'value', '' );
        this.showOverlay( view, buttonView );
    },

    showOverlay: function showOverlay ( view, buttonView ) {
        // If we're in the overflow menu, align with the "More" button.
        if ( buttonView.getParent( MenuView ) ) {
            buttonView = this.get( 'toolbarView' ).getView( 'overflow' );
        }
        var richTextView = this;
        popOver.show({
            view: view,
            alignWithView: buttonView,
            showCallout: true,
            offsetTop: 2,
            offsetLeft: -4,
            onHide: function () {
                richTextView.focus();
            },
        });
    },

    // --- Commands ---

    focus: function focus () {
        var editor = this.get( 'editor' );
        if ( editor ) {
            editor.focus();
        }
        return this;
    },

    blur: function blur () {
        var editor = this.get( 'editor' );
        if ( editor ) {
            editor.blur();
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

    setTextColor: execCommand( 'setTextColour' ),
    setHighlightColor: execCommand( 'setHighlightColour' ),

    setTextAlignment: execCommand( 'setTextAlignment' ),
    setTextDirection: execCommand( 'setTextDirection' ),

    increaseQuoteLevel: execCommand( 'increaseQuoteLevel' ),
    decreaseQuoteLevel: execCommand( 'decreaseQuoteLevel' ),

    makeUnorderedList: execCommand( 'makeUnorderedList' ),
    makeOrderedList: execCommand( 'makeOrderedList' ),
    removeList: execCommand( 'removeList' ),

    increaseListLevel: execCommand( 'increaseListLevel' ),
    decreaseListLevel: execCommand( 'decreaseListLevel' ),

    code: execCommand( 'code' ),
    removeCode: execCommand( 'removeCode' ),

    removeAllFormatting: execCommand( 'removeAllFormatting' ),

    insertImage: execCommand( 'insertImage' ),
    insertImagesFromFiles: function insertImagesFromFiles ( files ) {
        var this$1 = this;

        if ( window.FileReader ) {
            files.forEach( function (file) {
                var img = this$1.get( 'editor' ).insertImage();
                var reader = new FileReader();
                reader.onload = function () {
                    img.src = reader.result;
                    reader.onload = null;
                };
                reader.readAsDataURL( file );
            });
        }
    },

    getSelectedText: function getSelectedText () {
        var editor = this.get( 'editor' );
        return editor ? editor.getSelectedText() : '';
    },

    kbShortcuts: function ( event ) {
        var isMac = UA.isMac;
        switch ( lookupKey( event ) ) {
        case isMac ? 'Meta-k' : 'Ctrl-k':
            event.preventDefault();
            this.showLinkOverlay(
                this.get( 'toolbarView' ).getView( 'link' )
            );
            break;
        case 'PageDown':
            if ( !isMac ) {
                var scrollView = this.getParent( ScrollView );
                if ( scrollView ) {
                    scrollView.scrollToView( this, {
                        y: 32 +
                            this.get( 'pxHeight' ) -
                            scrollView.get( 'pxHeight' ),
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

    isBold: queryCommandState( 'B' ),
    isItalic: queryCommandState( 'I' ),
    isUnderlined: queryCommandState( 'U' ),
    isStriked: queryCommandState( 'S' ),
    isLink: queryCommandState( 'A' ),
    isCode: function () {
        var regexp = new RegExp( '(?:^|>)(?:PRE|CODE)\\b' );
        var editor = this.get( 'editor' );
        var path = this.get( 'path' );
        return path === '(selection)' ?
            editor.hasFormat( 'PRE' ) || editor.hasFormat( 'CODE' ) :
            regexp.test( path );
    }.property( 'path' ),

    alignment: function () {
        var path = this.get( 'path' );
        var results = /\.align-(\w+)/.exec( path );
        var alignment;
        if ( path === '(selection)' ) {
            alignment = '';
            this._forEachBlock( function (block) {
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
        var path = this.get( 'path' );
        var results = /\[dir=(\w+)\]/.exec( path );
        var dir;
        if ( path === '(selection)' ) {
            dir = '';
            this._forEachBlock( function (block) {
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

    isUnorderedList: queryCommandState( 'UL' ),
    isOrderedList: queryCommandState( 'OL' ),

    // --- Keep state in sync with render ---

    handleEvent: function handleEvent ( event ) {
        // Ignore real dragover/drop events from Squire. They wil be handled
        // by the standard event delegation system. We only observe these
        // to get the image paste fake dragover/drop events.
        var type = event.type;
        if ( ( type === 'dragover' || type === 'drop' ) &&
                event.stopPropagation ) {
            return;
        }
        ViewEventsController.handleEvent( event, this );
    },

    _onFocus: function () {
        this.set( 'isFocused', true );
    }.on( 'focus' ),

    _onBlur: function () {
        this.set( 'isFocused', false );
    }.on( 'blur' ),

    blurOnEsc: function ( event ) {
        // If key == esc, we want to blur. Not all browsers do this
        // automatically.
        if ( ( event.keyCode || event.which ) === 27 ) {
            this.blur();
        }
    }.on( 'keydown' ),

    // Chrome (and Opera) as of 2018-09-24 have a bug where if an image is
    // inside a link, clicking the image actually loads the link, even though
    // it's inside a content editable area.
    click: function ( event ) {
        var target = event.target;
        if ( !isClickModified( event ) &&
                target.nodeName === 'IMG' &&
                Element$1.nearest( target, 'A', this.get( 'layer' ) ) ) {
            event.preventDefault();
        }
    }.on( 'click' ),

    // -- Drag and drop ---

    dropAcceptedDataTypes: {
        'image/gif': true,
        'image/jpeg': true,
        'image/png': true,
        'image/tiff': true,
    },

    dropEffect: COPY,

    drop: function drop ( drag ) {
        var this$1 = this;

        var types = this.get( 'dropAcceptedDataTypes' );
        for ( var type in types ) {
            if ( drag.hasDataType( type ) ) {
                this$1.insertImagesFromFiles( drag.getFiles( /^image\/.*/ ) );
                break;
            }
        }
    },
});

RichTextView.isSupported = (
    ( 'contentEditable' in document.body ) &&
    // Opera Mobile. Yeh, no.
    ( !UA.operaMobile ) &&
    // Windows Phone as of v8.1 (IE11) is still pretty buggy
    ( !UA.isWinPhone ) &&
    // WKWebView (introduced in iOS8) finally supports RTV without horrendous
    // bugs.
    ( !UA.isIOS || UA.isWKWebView )
);

RichTextView.TOOLBAR_HIDDEN = TOOLBAR_HIDDEN;
RichTextView.TOOLBAR_INLINE = TOOLBAR_INLINE;
RichTextView.TOOLBAR_AT_SELECTION = TOOLBAR_AT_SELECTION;
RichTextView.TOOLBAR_AT_TOP = TOOLBAR_AT_TOP;

var isMac$1 = UA.isMac;
var allowedInputs = {
    checkbox: 1,
    radio: 1,
    file: 1,
    submit: 1,
};

var DEFAULT_IN_INPUT = 0;
var ACTIVE_IN_INPUT = 1;
var DISABLE_IN_INPUT = 2;

var handleOnDown = {};

var toPlatformKey = function ( key ) {
    if ( key.contains( 'Cmd-' ) ) {
        key = key.replace( 'Cmd-', isMac$1 ? 'Meta-' : 'Ctrl-' );
        if ( !isMac$1 &&
                key.contains( 'Shift-' ) &&
                key.charAt( key.length - 2 ) === '-' ) {
            // The shift modifier is applied to the key returned (so it is
            // uppercase) if the Ctrl key is pressed, but not if Meta is
            // pressed
            key = key.slice( 0, -1 ) + key.slice( -1 ).toUpperCase();
        }
    }
    return key;
};

/**
    Class: O.GlobalKeyboardShortcuts

    Extends: O.Object

    This class facilitates adding keyboard shortcuts to your application.
*/
var GlobalKeyboardShortcuts = Class({

    Extends: Obj,

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
    init: function init (/* ...mixins */) {
        this.isEnabled = true;
        this._shortcuts = {};

        GlobalKeyboardShortcuts.parent.constructor.apply( this, arguments );

        ViewEventsController.kbShortcuts = this;
        ViewEventsController.addEventTarget( this, -10 );
    },

    /**
        Method: O.GlobalKeyboardShortcuts#destroy

        Destructor.
    */
    destroy: function destroy () {
        if ( ViewEventsController.kbShortcuts === this ) {
            delete ViewEventsController.kbShortcuts;
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
            key     - {String} The key to trigger the callback on. Modifier keys
                      (Alt, Ctrl, Meta, Shift) should be prefixed in
                      alphabetical order and with a hypen after each one.
                      Letters should be lower case. e.g. `Ctrl-f`.

                      The special modifier "Cmd-" may be used, which will map
                      to "Meta-" on a Mac (the command key) and "Ctrl-"
                      elsewhere.
            object  - {Object} The object to trigger the callback on.
            method  - {String} The name of the method to trigger.
            ifInput - {Number} Determines whether the shortcut is active when
                      focused inside an <input> or equivalent. Defaults to
                      active if and only if Meta or Ctrl are part of the
                      shortcut. The value must be one of:

                      * DEFAULT_IN_INPUT (Use the default)
                      * ACTIVE_IN_INPUT (Active when input is focused)
                      * DISABLE_IN_INPUT (Not active when input is focused)

        Returns:
            {O.GlobalKeyboardShortcuts} Returns self.
    */
    register: function register ( key, object, method, ifInput ) {
        key = toPlatformKey( key );
        var shortcuts = this._shortcuts;
        ( shortcuts[ key ] || ( shortcuts[ key ] = [] ) )
            .push([ object, method, ifInput || DEFAULT_IN_INPUT ]);
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
    deregister: function deregister ( key, object, method ) {
        var this$1 = this;

        key = toPlatformKey( key );
        var current = this._shortcuts[ key ];
        var length = current ? current.length : 0;
        var l = length;
        while ( l-- ) {
            var item = current[l];
            if ( item[0] === object && item[1] === method ) {
                if ( length === 1 ) {
                    delete this$1._shortcuts[ key ];
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
    getHandlerForKey: function getHandlerForKey ( key ) {
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
        var target = event.target;
        var nodeName = target.nodeName;
        var isSpecialKey = event.ctrlKey || event.metaKey;
        var inputIsFocused = (
            nodeName === 'TEXTAREA' ||
            nodeName === 'SELECT' ||
            ( nodeName === 'INPUT' && !allowedInputs[ target.type ] ) ||
            ( event.targetView instanceof RichTextView )
        );
        var key = lookupKey( event );
        if ( event.type === 'keydown' ) {
            handleOnDown[ key ] = true;
        } else if ( handleOnDown[ key ] ) {
            return;
        }
        var handler = this.getHandlerForKey( key );
        if ( handler ) {
            var ifInput = handler[2];
            if ( inputIsFocused && ifInput !== ACTIVE_IN_INPUT &&
                    ( !isSpecialKey || ifInput === DISABLE_IN_INPUT ) ) {
                return;
            }
            handler[0][ handler[1] ]( event );
            if ( !event.doDefault ) {
                event.preventDefault();
            }
        }
    }.on( 'keydown', 'keypress' ),
});

GlobalKeyboardShortcuts.DEFAULT_IN_INPUT = DEFAULT_IN_INPUT;
GlobalKeyboardShortcuts.ACTIVE_IN_INPUT = ACTIVE_IN_INPUT;
GlobalKeyboardShortcuts.DISABLE_IN_INPUT = DISABLE_IN_INPUT;

/*global document, window, history, location */

/**
    Module: Application

    The Application module contains classes for managing an HTML5 application.
*/

var getHash = function ( location ) {
    var href = location.href;
    var i = href.indexOf( '#/' );
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
var Router = Class({

    Extends: Obj,

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

    init: function init ( mixin$$1, win ) {
        Router.parent.constructor.call( this, mixin$$1 );
        if ( !win ) {
            win = window;
        }
        var location = win.location;
        var path = ( this.useHash && getHash( location ) ) ||
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
        var location = this._win.location;
        var path = this.useHash ?
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
    restoreStateFromUrl: function restoreStateFromUrl ( url ) {
        var this$1 = this;

        var routes = this.get( 'routes' );

        for ( var i = 0, l = routes.length; i < l; i += 1 ) {
            var route = routes[i];
            var match = route.url.exec( url );
            if ( match ) {
                this$1.beginPropertyChanges();
                route.handle.apply( this$1, match );
                this$1.endPropertyChanges();
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
        var state = this.get( 'encodedState' );
        var replaceState = this.get( 'replaceState' );
        var win = this._win;
        if ( this.get( 'currentPath' ) !== state ) {
            this.set( 'currentPath', state );
            if ( this.useHash ) {
                var location = win.location;
                if ( replaceState ) {
                    var href = location.href;
                    var i = href.indexOf( '#' );
                    if ( i > -1 ) {
                        href = href.slice( 0, i );
                    }
                    location.replace( href + '#/' + state );
                } else {
                    location.hash = '#/' + state;
                }
            } else {
                var history = win.history;
                var title = this.get( 'title' );
                var url = this.getUrlForEncodedState( state );
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

    getUrlForEncodedState: function getUrlForEncodedState ( state ) {
        return this.get( 'baseUrl' ) + state;
    },
});

/*global document */

/**
    Namespace: O.Stylesheet

    The O.Stylesheet namespace contains helper functions for dealing with CSS
    stylesheets.
*/
var Stylesheet = {
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
    create: function create ( id, css ) {
        var style = Element$1.create( 'style', {
            type: 'text/css',
            id: id,
            text: css,
        });
        document.head.appendChild( style );
        return style;
    },
};

/*global document */

/**
    Class: O.ThemeManager

    Extends: O.Object

    The O.ThemeManager class manages the themes for an application. A theme
    consists of stylesheets and images. These can be loaded in stages and
    hotswapped if themes are changed.
*/
var ThemeManager = Class({

    Extends: Obj,

    init: function init (/* ...mixins */) {
        this._images = { all: {} };
        this._styles = { all: {} };
        this._activeStylesheets = {};

        this.theme = '';

        ThemeManager.parent.constructor.apply( this, arguments );
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
    changeTheme: function changeTheme ( oldTheme, newTheme ) {
        var this$1 = this;

        var active = this._activeStylesheets;
        for ( var id in active ) {
            if ( active[ id ] ) {
                this$1.addStylesheet( id, newTheme );
                this$1.removeStylesheet( id, oldTheme );
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
    imageDidLoad: function imageDidLoad ( theme, id, data ) {
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
    stylesheetDidLoad: function stylesheetDidLoad ( theme, id, data ) {
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
    addStylesheet: function addStylesheet ( id, theme ) {
        if ( !theme ) {
            theme = this.get( 'theme' );
        }

        var styles = this._styles[ theme ] || {};
        var images = this._images[ theme ] || {};
        var themeIndependentImages = this._images.all;
        var data = styles[ id ] || this._styles.all[ id ] || '';
        var active = this._activeStylesheets;

        if ( data ) {
            // Substitute in images.
            data = data.replace( /url\(([^)]+)\)/g, function ( url, src ) {
                var imageData =
                        images[ src ] ||
                        themeIndependentImages[ src ] ||
                        loc( src );
                if ( /\.svg$/.test( src ) ) {
                    imageData = 'data:image/svg+xml;charset=UTF-8,' +
                        encodeURIComponent( imageData );
                }
                return 'url(' + ( imageData || src ) + ')';
            });
        }

        // Even if no data, create the stylesheet as we'll probably change it
        // for a different theme that's currently loading.
        Stylesheet.create( theme + '-' + id, data );
        active[ id ] = ( active[ id ] || 0 ) + 1;

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
    removeStylesheet: function removeStylesheet ( id, theme ) {
        if ( !theme ) {
            theme = this.get( 'theme' );
        }

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
    getImageSrc: function getImageSrc ( id ) {
        var _images = this._images;
        var themeImages = _images[ this.get( 'theme' ) ] || {};
        var themeIndependentImages = _images.all;
        return themeImages[ id ] || themeIndependentImages[ id ] || null;
    },
});

/*global JSON, window, document, localStorage */

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
var WindowController = Class({

    Extends: Obj,

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
        Property: O.WindowController#isFocused
        Type: Boolean

        Is the tab/window currently focused?
    */

    /**
        Property: O.WindowController#id
        Type: String

        A unique id for the window, guaranteed to be different than for any
        other open window.
    */

    init: function init (/* ...mixins */) {
        this.id = new Date().format( '%y%m%d%H%M%S' ) + Math.random();
        this.isMaster = false;
        this.isFocused = document.hasFocus ? document.hasFocus() : true;

        this._seenWCs = {};
        this._checkTimeout = null;
        this._pingTimeout = null;

        WindowController.parent.constructor.apply( this, arguments );

        window.addEventListener( 'storage', this, false );
        window.addEventListener( 'unload', this, false );
        window.addEventListener( 'focus', this, false );
        window.addEventListener( 'blur', this, false );

        this.start();
    },

    destroy: function destroy () {
        this.end( this.get( 'broadcastKey' ) );

        window.removeEventListener( 'storage', this, false );
        window.removeEventListener( 'unload', this, false );
        window.removeEventListener( 'focus', this, false );
        window.removeEventListener( 'blur', this, false );

        WindowController.parent.destroy.call( this );
    },

    start: function start () {
        var this$1 = this;

        this.broadcast( 'wc:hello' );

        var check = function () {
            this$1.checkMaster();
            this$1._checkTimeout = RunLoop.invokeAfterDelay( check, 9000 );
        };
        var ping = function () {
            this$1.sendPing();
            this$1._pingTimeout = RunLoop.invokeAfterDelay( ping, 17000 );
        };
        this._checkTimeout = RunLoop.invokeAfterDelay( check, 500 );
        this._pingTimeout = RunLoop.invokeAfterDelay( ping, 17000 );
    },

    end: function end ( broadcastKey ) {
        RunLoop.cancel( this._pingTimeout )
               .cancel( this._checkTimeout );

        this.broadcast( 'wc:bye', null, broadcastKey );
    },

    broadcastKeyDidChange: function ( _, __, oldBroadcastKey ) {
        this.end( oldBroadcastKey );
        this.start();
    }.observes( 'broadcastKey' ),

    /**
        Method (protected): O.WindowController#handleEvent

        Handles storage, unload, focus and blur events.

        Parameters:
            event - {Event} The event object.
    */
    handleEvent: function ( event ) {
        switch ( event.type ) {
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
            this.set( 'isFocused', true );
            break;
        case 'blur':
            this.set( 'isFocused', false );
            break;
        }
    }.invokeInRunLoop(),


    /**
        Method (protected): O.WindowController#sendPing

        Sends a ping to let other windows know about the existence of this one.
        Automatically called periodically.
    */
    sendPing: function sendPing () {
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
    checkMaster: function checkMaster () {
        var now = Date.now();
        var isMaster = true;
        var seenWCs = this._seenWCs;
        var ourId = this.id;
        for ( var id in seenWCs ) {
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
            type         - {String} The name of the event being broadcast.
            data         - {Object} (optional). The data to broadcast.
            broadcastKey - {String} (optional). The key to use; otherwise the
                           key will be taken from the broadcastKey property.
    */
    broadcast: function broadcast ( type, data, broadcastKey ) {
        try {
            localStorage.setItem(
                broadcastKey || this.get( 'broadcastKey' ),
                JSON.stringify( Object.assign({
                    wcId: this.id,
                    type: type,
                }, data ))
            );
        } catch ( error ) {}
    },
});

WindowController.openExternal = function ( href ) {
    var newWindow = window.open( '', '_blank' );
    var htmlHref = href;
    if ( newWindow ) {
        // From goog.window.open; IE has trouble if there's a
        // semi-colon in the URL apparently.
        if ( UA.msie && href.indexOf( ';' ) > -1 ) {
            htmlHref = "'" + htmlHref.replace( /'/g, '%27' ) + "'";
        }
        htmlHref = htmlHref.escapeHTML().replace( /"/g, '&quot;' );
        try {
            newWindow.opener = null;
            newWindow.document.write(
                '<META HTTP-EQUIV="refresh" content="0; url=' +
                    htmlHref +
                '">'
            );
            newWindow.document.close();
        } catch ( error ) {
            var location = newWindow.location || window.location;
            location.href = href;
        }
    }
    return newWindow;
};

/**
    Class: O.RecordArray

    Extends: O.Object

    Includes: O.Enumerable

    An immutable enumerable object representing a list of records.
 */
var RecordArray = Class({

    Extends: Obj,

    Mixin: Enumerable,

    init: function init ( store, Type, storeKeys ) {
        this.store = store;
        this.Type = Type;
        this.storeKeys = storeKeys;

        RecordArray.parent.constructor.call( this );
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
    getObjectAt: function getObjectAt ( index ) {
        var storeKey = this.get( 'storeKeys' )[ index ];
        if ( storeKey ) {
            return this.get( 'store' ).materialiseRecord( storeKey );
        }
    },
});

var AUTO_REFRESH_NEVER = 0;
var AUTO_REFRESH_IF_OBSERVED = 1;
var AUTO_REFRESH_ALWAYS = 2;

/**
    Class: O.Query

    Extends: O.Object

    Includes: O.Enumerable, O.ObservableRange

    A remote query is conceptually an array of records, where the contents of
    the array is calculated by a server rather than the client. In its simplest
    form, you would use remote query like this:

        const query = new O.Query({
            store: TodoApp.store
            Type: TodoApp.TodoItem,
            where: 'done',
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

    The sort and where properties may have arbitrary value and type. They are
    there so your fetchQuery handler in source knows what to fetch. If they are
    changed, the query is refetched. The sort and where properties in the
    object passed to the sourceDidFetchQuery callback must be identical to the
    current values in the query for the data to be accepted.

    The server may also return a queryState string, which represents the current
    state of the query. The source may then send this to the server if the query
    is refreshed; if there have been no changes, the server can then avoid
    sending back unneccessary data.

*/
var Query = Class({

    Extends: Obj,

    Mixin: [ Enumerable, ObservableRange ],

    /**
        Property: O.Query#store
        Type: O.Store
    */

    /**
        Property: O.Query#Type
        Type: O.Class

        The type of records this query contains.
    */

    /**
        Property: O.Query#where
        Type: *

        Any filter to apply to the query. This MUST NOT change after init.
    */

    /**
        Property: O.Query#sort
        Type: *

        The sort order to use for this query. This MUST NOT change after init.
    */

    /**
        Property: O.Query#queryState
        Type: String

        A state string from the server to allow the query to fetch updates and
        to determine if its list is invalid.
    */

    /**
        Property: O.Query#status
        Type: O.Status

        The status of the query. Initially EMPTY, will be READY once it knows
        the number of records contained in the query and DESTROYED after you've
        finished with the query and called <O.Query#destroy>. It may also
        have OBSOLETE and LOADING bits set as appropriate.
    */

    /**
        Property: O.Query#length
        Type: (Number|null)

        The length of the list of records matching the query, or null if
        unknown.
    */

    autoRefresh: AUTO_REFRESH_NEVER,

    /**
        Constructor: O.Query

        Parameters:
            mixin - {Object} (optional) Any properties in this object will be
                    added to the new O.Query instance before
                    initialisation (so you can pass it getter/setter functions
                    or observing methods).
    */
    init: function init (/* ...mixins */) {
        this._storeKeys = [];
        this._awaitingIdFetch = [];
        this._refresh = false;

        this.id = guid( this );
        this.source = null;
        this.store = null;
        this.accountId = null;
        this.where = null;
        this.sort = null;
        this.queryState = '';
        this.status = EMPTY;
        this.length = null;
        this.lastAccess = Date.now();

        Query.parent.constructor.apply( this, arguments );

        this.get( 'store' ).addQuery( this );
        this.monitorForChanges();
        this.fetch();
    },

    /**
        Method: O.Query#destroy

        Sets the status to DESTROYED, deregisters the query with the store and
        removes bindings and path observers so the object may be garbage
        collected.
    */
    destroy: function destroy () {
        this.unmonitorForChanges();
        this.set( 'status', this.is( EMPTY ) ? NON_EXISTENT : DESTROYED );
        this.get( 'store' ).removeQuery( this );
        Query.parent.destroy.call( this );
    },

    monitorForChanges: function monitorForChanges () {
        var store = this.get( 'store' );
        var typeId = guid( this.get( 'Type' ) );
        var accountId = this.get( 'accountId' );
        store.on( typeId + ':server:' + accountId, this, 'setObsolete' );
    },

    unmonitorForChanges: function unmonitorForChanges () {
        var store = this.get( 'store' );
        var typeId = guid( this.get( 'Type' ) );
        var accountId = this.get( 'accountId' );
        store.off( typeId + ':server:' + accountId, this, 'setObsolete' );
    },

    // ---

    /**
        Method: O.Query#is

        Checks whether the query has a particular status. You can also supply a
        union of statuses (e.g. `query.is(O.Status.OBSOLETE|O.Status.DIRTY)`),
        in which case it will return true if the query has *any* of these status
        bits set.

        Parameters:
            status - {O.Status} The status to check.

        Returns:
            {Boolean} True if the record has the queried status.
    */
    is: function is ( status ) {
        return !!( this.get( 'status' ) & status );
    },

    /**
        Method: O.Query#setObsolete

        Sets the OBSOLETE bit on the query's status value.

        Returns:
            {O.Query} Returns self.
    */
    setObsolete: function setObsolete () {
        this.set( 'status', this.get( 'status' ) | OBSOLETE );
        switch ( this.get( 'autoRefresh' ) ) {
        case AUTO_REFRESH_IF_OBSERVED: {
            var metadata = meta( this );
            var observers = metadata.observers;
            var rangeObservers = metadata.rangeObservers;
            // Refresh if any of:
            // 1. Length is observed
            // 2. Contents ([]) is observed
            // 3. A range is observed
            if ( !observers.length && !observers[ '[]' ] &&
                    !( rangeObservers && rangeObservers.length ) ) {
                break;
            }
        }
        /* falls through */
        case AUTO_REFRESH_ALWAYS:
            this.fetch();
        }
        return this;
    },

    /**
        Method: O.Query#setLoading

        Sets the LOADING bit on the query's status value.

        Returns:
            {O.Query} Returns self.
    */
    setLoading: function setLoading () {
        return this.set( 'status', this.get( 'status' ) | LOADING );
    },

    // ---

    /**
        Method: O.Query#refresh

        Fetch the query or refresh if needed.

        Parameters:
            force        - {Boolean} (optional) Unless this is true, the remote
                           query will only ask the source to fetch updates if it
                           is marked EMPTY or OBSOLETE.
            callback     - {Function} (optional) A callback to be made
                           when the fetch finishes.

        Returns:
            {O.Query} Returns self.
    */
    fetch: function fetch ( force, callback ) {
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
        Method: O.Query#reset

        Resets the list, throwing away the id list, resetting the queryState
        string and setting the status to EMPTY.

        Returns:
            {O.Query} Returns self.
    */
    reset: function reset () {
        var length = this.get( 'length' );

        this._storeKeys.length = 0;
        this._refresh = false;

        return this
            .set( 'queryState', '' )
            .set( 'status', EMPTY )
            .set( 'length', null )
            .rangeDidChange( 0, length )
            .fire( 'query:reset' );
    },

    // ---

    /**
        Property: O.Query#[]
        Type: Array

        A standard array of record objects for the records in this query.
    */
    '[]': function () {
        var store = this.get( 'store' );
        return this._storeKeys.map( function (storeKey) { return (
            storeKey ? store.getRecordFromStoreKey( storeKey ) : null
        ); });
    }.property(),

    /**
        Method: O.Query#getStoreKeys

        Returns:
            {String[]} The store keys. You MUST NOT modify this.
    */
    getStoreKeys: function getStoreKeys () {
        return this._storeKeys;
    },

    /**
        Method: O.Query#getObjectAt

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
    getObjectAt: function getObjectAt ( index, doNotFetch ) {
        var length = this.get( 'length' );

        if ( length === null || index < 0 || index >= length ) {
            return undefined;
        }

        if ( !doNotFetch ) {
            doNotFetch = this.fetchDataForObjectAt( index );
        }

        var storeKey = this._storeKeys[ index ];
        return storeKey ?
            this.get( 'store' ).getRecordFromStoreKey( storeKey, doNotFetch ) :
            null;
    },

    /**
        Method: O.Query#fetchDataForObjectAt

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
    fetchDataForObjectAt: function fetchDataForObjectAt (/* index */) {
        return false;
    },

    /**
        Method: O.Query#indexOfStoreKey

        Finds the index of a store key in the query. Since the entire list may
        not be loaded, this data may have to be loaded from the server so you
        should rely on the callback if you need an accurate result. If the id
        is not found, the index returned will be -1.

        Parameters:
            storeKey - {String} The record store key to find.
            from     - {Number} The first index to start the search from.
                       Specify 0 to search the whole list.
            callback - {Function} (optional) A callback to make with the store
                       key when found.

        Returns:
            {Number} The index of the store key, or -1 if not found.
    */
    indexOfStoreKey: function indexOfStoreKey ( storeKey, from, callback ) {
        var this$1 = this;

        var index = this._storeKeys.indexOf( storeKey, from );
        if ( callback ) {
            if ( this.get( 'length' ) === null ) {
                this.fetch( false, function () {
                    callback( this$1._storeKeys.indexOf( storeKey, from ) );
                });
            } else {
                callback( index );
            }
        }
        return index;
    },

    /**
        Method: O.Query#getStoreKeysForObjectsInRange

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
    getStoreKeysForObjectsInRange: function getStoreKeysForObjectsInRange ( start, end, callback ) {
        var length = this.get( 'length' );

        if ( length === null ) {
            this._awaitingIdFetch.push([ start, end, callback ]);
            this.fetch();
            return true;
        }

        if ( start < 0 ) {
            start = 0;
        }
        if ( end > length ) {
            end = length;
        }
        callback( this._storeKeys.slice( start, end ), start, end );

        return false;
    },

    /**
        Method: O.Query#getStoreKeysForAllObjects

        Get a callback with an array of the store keys for all records in the
        query.

        Parameters:
            callback - {Function} This will be called with the array of store
                       keys as the first argument, the index of the first
                       returned result as the second argument, and one past the
                       index of the last result as the third argument.

        Returns:
            {Boolean} Is the data still loading? (i.e. this is true if the
            callback was not fired synchronously, but rather will be called
            asynchronously at a later point.)
    */
    getStoreKeysForAllObjects: function getStoreKeysForAllObjects ( callback ) {
        // 0x7fffffff is the largest positive signed 32-bit number.
        return this.getStoreKeysForObjectsInRange( 0, 0x7fffffff, callback );
    },

    // ---

    /**
        Method (private): O.Query#_adjustIdFetches

        Modifies the id range to be returned in the callback to
        <O.Query#getStoreKeysForObjectsInRange> in response to an update
        from the server.

        We adjust the range being fetched mainly so that new records that are
        inserted at the top of the list during a selection are not selected.
        Otherwise you may hit select all then hit delete as soon as it's
        selected, but in the meantime a new record arrives at the top of the
        list; if this were included in the selection it may be accidentally
        deleted.

        Parameters:
            removed - {Number[]} The list of indexes which were removed.
            added   - {Number[]} The list of indexes where new records
                       were addded.
    */
    _adjustIdFetches: function ( event ) {
        var added = event.addedIndexes;
        var removed = event.removedIndexes;
        var awaitingIdFetch = this._awaitingIdFetch;
        var i, l, call, start, end, j, ll, index;
        for ( i = 0, l = awaitingIdFetch.length; i < l; i += 1 ) {
            call = awaitingIdFetch[i];
            start = call[0];
            end = call[1];

            for ( j = 0, ll = removed.length; j < ll; j += 1 ) {
                index = removed[j];
                if ( index < start ) {
                    start -= 1;
                }
                if ( index < end ) {
                    end -= 1;
                }
            }

            for ( j = 0, ll = added.length; j < ll; j += 1 ) {
                index = added[j];
                if ( index <= start ) {
                    start += 1;
                }
                if ( index < end ) {
                    end += 1;
                }
            }

            // Update waiting method call arguments
            call[0] = start;
            call[1] = end;
        }
    }.on( 'query:updated' ),

    /**
        Method (private): O.Query#_idsWereFetched

        This processes any waiting callbacks after a fetch has completed. There
        may be multiple packets arriving so this method is only invoked once per
        runloop, before bindings sync (which will be after all data packets have
        been delivered).
    */
    _idsWereFetched: function () {
        var this$1 = this;

        var awaitingIdFetch = this._awaitingIdFetch;
        if ( awaitingIdFetch.length ) {
            this._awaitingIdFetch = [];
            awaitingIdFetch.forEach( function (call) {
                this$1.getStoreKeysForObjectsInRange( call[0], call[1], call[2] );
            });
        }
    }.queue( 'before' ).on( 'query:idsLoaded' ),

    // ---

    /**
        Method: O.Query#sourceWillFetchQuery

        The source should call this method just before it fetches the query. By
        default this function just sets the loading flag on the query, but
        subclasses may like to return an object reflecting exactly the what the
        source should fetch (see <O.WindowedQuery#sourceWillFetchQuery)
        for example.

        Returns:
            {Boolean} Does the list need refreshing or just fetching (the two
            cases may be the same, but can be handled separately if the server
            has an efficient way of calculating changes from the queryState).
    */
    sourceWillFetchQuery: function sourceWillFetchQuery () {
        var refresh = this._refresh;
        this._refresh = false;
        this.set( 'status',
            ( this.get( 'status' )|LOADING ) & ~OBSOLETE );
        return refresh;
    },

    /**
        Method: O.Query#sourceDidFetchQuery

        The source should call this method with the data returned from fetching
        the query.

        Parameters:
            storeKeys  - {String[]} The store keys of the records represented by
                         this query.
            queryState - {String} (optional) A string representing the state of
                         the query on the server at the time of the fetch.

        Returns:
            {Query} Returns self.
    */
    sourceDidFetchQuery: function sourceDidFetchQuery ( storeKeys, queryState ) {
        // Could use a proper diffing algorithm to calculate added/removed
        // arrays, but probably not worth it.
        var oldStoreKeys = this._storeKeys;
        var oldTotal = this.get( 'length' );
        var total = storeKeys.length;
        var minTotal = Math.min( total, oldTotal || 0 );
        var index = {};
        var removedIndexes = [];
        var removedStoreKeys = [];
        var addedIndexes = [];
        var addedStoreKeys = [];
        var firstChange = 0;
        var lastChangeNew = total - 1;
        var lastChangeOld = ( oldTotal || 0 ) - 1;
        var i, storeKey;

        // Initial fetch, oldTotal === null
        if ( oldTotal !== null ) {
            while ( firstChange < minTotal &&
                    storeKeys[ firstChange ] === oldStoreKeys[ firstChange ] ) {
                firstChange += 1;
            }

            while ( lastChangeNew >= 0 && lastChangeOld >= 0 &&
                    ( storeKeys[ lastChangeNew ] ===
                        oldStoreKeys[ lastChangeOld ] ) ) {
                lastChangeNew -= 1;
                lastChangeOld -= 1;
            }

            for ( i = firstChange; i <= lastChangeOld; i += 1 ) {
                storeKey = oldStoreKeys[i];
                index[ storeKey ] = i;
            }

            for ( i = firstChange; i <= lastChangeNew; i += 1 ) {
                storeKey = storeKeys[i];
                if ( index[ storeKey ] === i ) {
                    index[ storeKey ] = -1;
                } else {
                    addedIndexes.push( i );
                    addedStoreKeys.push( storeKey );
                }
            }

            for ( i = firstChange; i <= lastChangeOld; i += 1 ) {
                storeKey = oldStoreKeys[i];
                if ( index[ storeKey ] !== -1 ) {
                    removedIndexes.push( i );
                    removedStoreKeys.push( storeKey );
                }
            }
        }

        lastChangeNew = ( total === oldTotal ) ?
            lastChangeNew + 1 : Math.max( oldTotal || 0, total );

        this._storeKeys = storeKeys;
        this.beginPropertyChanges()
            .set( 'queryState', queryState || '' )
            .set( 'status', READY|( this.is( OBSOLETE ) ? OBSOLETE : 0 ) )
            .set( 'length', total );
        if ( firstChange < lastChangeNew ) {
            this.rangeDidChange( firstChange, lastChangeNew );
        }
        this.endPropertyChanges();

        if ( oldTotal !== null && firstChange < lastChangeNew ) {
            this.fire( 'query:updated', {
                query: this,
                removed: removedStoreKeys,
                removedIndexes: removedIndexes,
                added: addedStoreKeys,
                addedIndexes: addedIndexes,
            });
        }
        return this.fire( 'query:idsLoaded' );
    },
});

Query.AUTO_REFRESH_NEVER = AUTO_REFRESH_NEVER;
Query.AUTO_REFRESH_IF_OBSERVED = AUTO_REFRESH_IF_OBSERVED;
Query.AUTO_REFRESH_ALWAYS = AUTO_REFRESH_ALWAYS;

/**
    Class: O.LocalQuery

    Extends: O.Query

    Includes: O.ObserverableRange, O.Enumerable

    A LocalQuery instance can be treated as an observable array which
    automatically updates its contents to reflect a certain query on the store.
    A query consists of a particular type, a filter function and a sort order.
    Normally you will not create a LocalQuery instance yourself but get it by
    retrieving the query from the store.
 */
var LocalQuery = Class({

    Extends: Query,

    autoRefresh: Query.AUTO_REFRESH_ALWAYS,

    /**
        Constructor: O.LocalQuery

        The following properties should be configured:

        store - {O.Store} The store to query for records.
        Type  - {O.Class} The constructor for the record type this query is a
                collection of.
        where - {Function} (optional) If supplied, only records which this
                function returns a truthy value for are included in the
                results.
        sort  - {(String|String[]|Function)} (optional) The records in
                the local query are sorted according to this named property. If
                an array is supplied, in the case of a tie the next property in
                the array will be consulted. If a function is supplied, this is
                used as the sort function directly on the records. If nothing
                is supplied, the results are not guaranteed to be in any
                particular order.

        Parameters:
            mixin - {Object} The properties for the query.
    */
    init: function init ( mixin$$1 ) {
        this.dependsOn = null;
        this.where = null;
        this.sort = null;

        var sort = mixin$$1.sort;
        if ( sort && !( sort instanceof Function ) ) {
            mixin$$1.sort = sortByProperties( sort );
        }

        LocalQuery.parent.constructor.apply( this, arguments );
    },

    monitorForChanges: function monitorForChanges () {
        var store = this.get( 'store' );
        var types = this.get( 'dependsOn' ) || [ this.get( 'Type' ) ];
        types.forEach( function ( Type ) {
            store.on( Type, this, 'setObsolete' );
        }, this );
    },

    unmonitorForChanges: function unmonitorForChanges () {
        var store = this.get( 'store' );
        var types = this.get( 'dependsOn' ) || [ this.get( 'Type' ) ];
        types.forEach( function ( Type ) {
            store.off( Type, this, 'setObsolete' );
        }, this );
    },

    fetch: function fetch ( force, callback ) {
        var status = this.get( 'status' );

        if ( force || status === EMPTY || ( status & OBSOLETE ) ) {
            var Type = this.get( 'Type' );
            var store = this.get( 'store' );
            store.fetchAll( Type );
            if ( store.getTypeStatus( Type ) & READY ) {
                this.sourceWillFetchQuery();
                this.sourceDidFetchQuery(
                    store.findAll(
                        Type, this.get( 'where' ), this.get( 'sort' ) )
                );
            }
        }

        if ( callback ) {
            callback();
        }

        return this;
    },
});

/**
    Enum: O.WindowedQuery-WindowState

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
var WINDOW_EMPTY = 0;
var WINDOW_REQUESTED = 1;
var WINDOW_LOADING = 2;
var WINDOW_READY = 4;
var WINDOW_RECORDS_REQUESTED = 8;
var WINDOW_RECORDS_LOADING = 16;
var WINDOW_RECORDS_READY = 32;

/**
    Method: O.WindowedQuery-sortLinkedArrays

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
    var zipped = a1.map( function ( item, i ) { return [ item, a2[i] ]; } );
    zipped.sort( function ( a, b ) { return a[0] - b[0]; } );
    zipped.forEach( function ( item, i ) {
        a1[i] = item[0];
        a2[i] = item[1];
    });
};

var mapIndexes = function ( list, storeKeys ) {
    var indexOf = {};
    var indexes = [];
    var listLength = list.length;
    var storeKeysLength = storeKeys.length;
    // Since building the map will be O(n log n), only bother if we're trying to
    // find the index for more than log(n) store keys.
    // The +1 ensures it is always at least 1, so that in the degenerative case
    // where storeKeysLength == 0, we never bother building the map
    // When listLength == 0, Math.log( 0 ) == -Infinity, which is converted to 0
    // by ~~ integer conversion.
    if ( storeKeysLength < ~~Math.log( listLength ) + 1 ) {
        for ( var i = 0; i < storeKeysLength; i += 1 ) {
            indexes.push( list.indexOf( storeKeys[i] ) );
        }
    } else {
        for ( var i$1 = 0; i$1 < listLength; i$1 += 1 ) {
            var id = list[i$1];
            if ( id ) {
                indexOf[ id ] = i$1;
            }
        }
        for ( var i$2 = 0; i$2 < storeKeysLength; i$2 += 1 ) {
            var index = indexOf[ storeKeys[i$2] ];
            indexes.push( index === undefined ? -1 : index );
        }
    }
    return indexes;
};

/**
    Method: O.WindowedQuery-mergeSortedLinkedArrays

    Parameters:
        a1 - {Array}
        a2 - {Array}
        b1 - {Array}
        b2 - {Array}

    Returns:
        {[Array,Array]} A tuple of two arrays.
*/
var mergeSortedLinkedArrays = function ( a1, a2, b1, b2 ) {
    var rA = [];
    var rB = [];
    var i = 0;
    var j = 0;
    var l1 = a1.length;
    var l2 = a2.length;

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

var adjustIndexes = function ( removed, added, removedBefore, storeKeys,
        removedBeforeStoreKeys ) {
    var resultIndexes = [];
    var resultStoreKeys = [];
    for ( var i = 0, l = removed.length; i < l; i += 1 ) {
        // Take the item removed in the second update
        var index = removed[i];
        // And see how many items were added in the first update
        // before it
        var position = added.binarySearch( index );
        // If there was an item added in the first update at the exact same
        // position, we don't need to do anything as they cancel each other out.
        // Since update 2 is from the state left by update 1, the storeKeys
        // MUST be the same.
        if ( index === added[ position ] ) {
            continue;
        }
        // Otherwise, subtract the number of items added before it, as
        // these didn't exist in the original state.
        index -= position;
        // Now consider the indexes that were removed in the first
        // update. We need to increment the index for all indexes
        // before or equal to the index we're considering.
        for ( var j = 0, ll = removedBefore.length;
                j < ll && index >= removedBefore[j]; j += 1 ) {
            index += 1;
        }
        // Now we have the correct index.
        resultIndexes.push( index );
        resultStoreKeys.push( storeKeys[i] );
    }
    return mergeSortedLinkedArrays(
        removedBefore, resultIndexes, removedBeforeStoreKeys, resultStoreKeys );
};

var composeUpdates = function ( u1, u2 ) {
    var removed = adjustIndexes(
            u2.removedIndexes, u1.addedIndexes,  u1.removedIndexes,
            u2.removedStoreKeys, u1.removedStoreKeys );
    var added = adjustIndexes(
            u1.addedIndexes, u2.removedIndexes, u2.addedIndexes,
            u1.addedStoreKeys, u2.addedStoreKeys );

    return {
        removedIndexes: removed[0],
        removedStoreKeys: removed[1],
        addedIndexes: added[0],
        addedStoreKeys: added[1],
        truncateAtFirstGap:
            u1.truncateAtFirstGap || u2.truncateAtFirstGap,
        total: u2.total,
        upToId: u2.upToId,
    };
};

var invertUpdate = function ( u ) {
    var array = u.removedIndexes;
    u.removedIndexes = u.addedIndexes;
    u.addedIndexes = array;

    array = u.removedStoreKeys;
    u.removedStoreKeys = u.addedStoreKeys;
    u.addedStoreKeys = array;

    u.total = u.total + u.addedStoreKeys.length - u.removedStoreKeys.length;

    return u;
};

// Where (a,b) and (c,d) are ranges.
// and a < b and c < d.
var intersect = function ( a, b, c, d ) {
    return a < c ? c < b : a < d;
};

var updateIsEqual = function ( u1, u2 ) {
    return u1.total === u2.total &&
        isEqual( u1.addedIndexes, u2.addedIndexes ) &&
        isEqual( u1.addedStoreKeys, u2.addedStoreKeys ) &&
        isEqual( u1.removedIndexes, u2.removedIndexes ) &&
        isEqual( u1.removedStoreKeys, u2.removedStoreKeys );
};

// A window is determined to be still required if there is a range observer that
// intersects with any part of the window. The prefetch distance is added to the
// observer range.
var windowIsStillInUse = function ( index, windowSize, prefetch, ranges ) {
    var start = index * windowSize;
    var margin = prefetch * windowSize;
    var j = ranges.length;
    while ( j-- ) {
        var range = ranges[j];
        var rangeStart = range.start || 0;
        if ( !( 'end' in range ) ) {
            break;
        }
        var rangeEnd = range.end;
        var rangeIntersectsWindow = intersect(
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
    Class: O.WindowedQuery

    Extends: O.Query

    A windowed remote query represents a potentially very large array of records
    calculated by the server. Records are loaded in blocks (windows); for
    example, with a window size of 30, accessing any record at indexes 0--29
    will cause all records within that range to be loaded, but does not
    necessarily load anything else.

    The class also supports an efficient modification sequence system for
    calculating, transfering and applying delta updates as the results of the
    query changes.
*/
var WindowedQuery = Class({

    Extends: Query,

    /**
        Property: O.WindowedQuery#windowSize
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
        Property: O.WindowedQuery#triggerPoint
        Type: Number

        If the record at an index less than this far from the end of a window is
        requested, the adjacent window will also be loaded (prefetching based on
        locality)
    */
    triggerPoint: 10,

    /**
        Property: O.WindowedQuery#optimiseFetching
        Type: Boolean

        If true, if a requested window is no longer either observed or adjacent
        to an observed window at the time <sourceWillFetchQuery> is called, the
        window is not actually requested.
    */
    optimiseFetching: false,

    /**
        Property: O.WindowedQuery#prefetch
        Type: Number

        The number of windows either side of an explicitly requested window, for
        which ids should be fetched.
    */
    prefetch: 1,

    /**
        Property: O.WindowedQuery#canGetDeltaUpdates
        Type: Boolean

        If the state is out of date, can the source fetch the delta of exactly
        what has changed, or does it just need to throw out the current list and
        refetch?
    */
    canGetDeltaUpdates: true,

    /**
        Property (private): O.WindowedQuery#_isAnExplicitIdFetch
        Type: Boolean

        This is set to true when an explicit request is made to fetch ids (e.g.
        through <O.Query#getStoreKeysForObjectsInRange>). This prevents
        the query from optimising away the request when it corresponds to a
        non-observed range in the query.
    */

    /**
        Property: O.WindowedQuery#allIdsAreLoaded
        Type: Boolean

        Do we have the complete list of ids for this query in memory?
        This is *not* currently observable.
    */
    allIdsAreLoaded: function () {
        var l = this.get( 'windowCount' );
        var windows = this._windows;
        if ( l === null ) {
            return false;
        }
        while ( l-- ) {
            if ( !( windows[l] & WINDOW_READY ) ) {
                break;
            }
        }
        return ( l < 0 );
    }.property().nocache(),

    init: function init (/* ...mixins */) {
        this._windows = [];
        this._indexOfRequested = [];
        this._waitingPackets = [];
        this._preemptiveUpdates = [];

        this._isAnExplicitIdFetch = false;

        WindowedQuery.parent.constructor.apply( this, arguments );
    },

    reset: function reset () {
        this._windows.length =
        this._indexOfRequested.length =
        this._waitingPackets.length =
        this._preemptiveUpdates.length = 0;

        this._isAnExplicitIdFetch = false;

        WindowedQuery.parent.reset.call( this );
    },

    _toStoreKey: function () {
        var store = this.get( 'store' );
        var accountId = this.get( 'accountId' );
        var Type = this.get( 'Type' );
        return function (id) { return store.getStoreKey( accountId, Type, id ); };
    }.property(),

    indexOfStoreKey: function indexOfStoreKey ( storeKey, from, callback ) {
        var this$1 = this;

        var index = this._storeKeys.indexOf( storeKey, from );
        if ( callback ) {
            // If we have a callback and haven't found it yet, we need to keep
            // searching.
            if ( index < 0 ) {
                // First check if the list is loaded
                if ( this.get( 'allIdsAreLoaded' ) ) {
                    // Everything loaded; the id simply isn't in it.
                    // index is -1.
                    callback( index );
                    return index;
                }
                // We're missing part of the list, so it may be in the missing
                // bit.
                var store = this.get( 'store' );
                var id = store.getIdFromStoreKey( storeKey );
                this._indexOfRequested.push([
                    id,
                    function () {
                        callback( this$1._storeKeys.indexOf( storeKey, from ) );
                    } ]);
                this.get( 'source' ).fetchQuery( this );
            } else {
                callback( index );
            }
        }
        return index;
    },

    getStoreKeysForObjectsInRange: function getStoreKeysForObjectsInRange ( start, end, callback ) {
        var this$1 = this;

        var length = this.get( 'length' );
        var isComplete = true;
        var windows, windowSize;

        if ( length !== null ) {
            if ( start < 0 ) {
                start = 0;
            }
            if ( end > length ) {
                end = length;
            }

            windows = this._windows;
            windowSize = this.get( 'windowSize' );
            var i = Math.floor( start / windowSize );
            var l = Math.floor( ( end - 1 ) / windowSize ) + 1;

            for ( ; i < l; i += 1 ) {
                if ( !( windows[i] & WINDOW_READY ) ) {
                    isComplete = false;
                    this$1._isAnExplicitIdFetch = true;
                    this$1.fetchWindow( i, false, 0 );
                }
            }
        } else {
            isComplete = false;
        }

        if ( isComplete ) {
            callback( this._storeKeys.slice( start, end ), start, end );
        } else {
            this._awaitingIdFetch.push([ start, end, callback ]);
        }
        return !isComplete;
    },

    // Fetches all ids and records in window.
    // If within trigger distance of window edge, fetches adjacent window as
    // well.
    fetchDataForObjectAt: function fetchDataForObjectAt ( index ) {
        // Load all headers in window containing index.
        var windowSize = this.get( 'windowSize' );
        var trigger = this.get( 'triggerPoint' );
        var windowIndex = Math.floor( index / windowSize );
        var withinWindowIndex = index % windowSize;

        this.fetchWindow( windowIndex, true );

        // If within trigger distance of end of window, load next window
        // Otherwise, just fetch ids for the next window.
        if ( withinWindowIndex < trigger ) {
            this.fetchWindow( windowIndex - 1, true );
        }
        if ( withinWindowIndex + trigger >= windowSize ) {
            this.fetchWindow( windowIndex + 1, true );
        }
        return true;
    },

    /**
        Method: O.WindowedQuery#fetchWindow

        Fetches all records in the window with the index given. e.g. if the
        window size is 30, calling this with index 1 will load all records
        between positions 30 and 59 (everything 0-indexed).

        Also fetches the ids for all records in the window either side.

        Parameters:
            index        - {Number} The index of the window to load.
            fetchRecords - {Boolean}
            prefetch     - {Number} (optional)

        Returns:
            {O.WindowedQuery} Returns self.
    */
    fetchWindow: function fetchWindow ( index, fetchRecords, prefetch ) {
        var this$1 = this;

        var status = this.get( 'status' );
        var windows = this._windows;
        var doFetch = false;

        if ( status & OBSOLETE ) {
            this.fetch();
        }

        if ( prefetch === undefined ) {
            prefetch = this.get( 'prefetch' );
        }

        var i = Math.max( 0, index - prefetch );
        var l = Math.min( index + prefetch + 1,
            this.get( 'windowCount' ) || 0 );

        for ( ; i < l; i += 1 ) {
            status = windows[i] || 0;
            if ( status === WINDOW_EMPTY ) {
                status = WINDOW_REQUESTED;
                doFetch = true;
            }
            if ( i === index && fetchRecords &&
                    status < WINDOW_RECORDS_REQUESTED ) {
                if ( ( status & WINDOW_READY ) &&
                        this$1.checkIfWindowIsFetched( i ) ) {
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
    checkIfWindowIsFetched: function checkIfWindowIsFetched ( index ) {
        var store = this.get( 'store' );
        var windowSize = this.get( 'windowSize' );
        var list = this._storeKeys;
        var i = index * windowSize;
        var l = Math.min( i + windowSize, this.get( 'length' ) );
        var status;
        for ( ; i < l; i += 1 ) {
            status = store.getStatus( list[i] );
            if ( !( status & READY ) ||
                    ( ( status & OBSOLETE ) && !( status & LOADING ) ) ) {
                return false;
            }
        }
        return true;
    },

    /**
        Method: O.WindowedQuery#recalculateFetchedWindows

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
    recalculateFetchedWindows: function recalculateFetchedWindows ( start, length ) {
        if ( !start ) {
            start = 0;
        }
        if ( length === undefined ) {
            length = this.get( 'length' );
        }

        var windowSize = this.get( 'windowSize' );
        var windows = this._windows;
        var list = this._storeKeys;
        // Start at last window index
        var windowIndex = Math.floor( ( length - 1 ) / windowSize );
        // And last list index
        var listIndex = length - 1;
        var target, status;

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

    _normaliseUpdate: function _normaliseUpdate ( update ) {
        var list = this._storeKeys;
        var removedStoreKeys = update.removed;
        var removedIndexes = mapIndexes( list, removedStoreKeys );
        var addedStoreKeys = [];
        var addedIndexes = [];
        var added = update.added;
        var i, j, l;

        sortLinkedArrays( removedIndexes, removedStoreKeys );
        for ( i = 0; removedIndexes[i] === -1; i += 1 ) {
            // Do nothing (we just want to find the first index of known
            // position).
        }
        // If we have some ids we don't know the index of.
        if ( i ) {
            // Ignore them.
            removedIndexes = removedIndexes.slice( i );
            removedStoreKeys = removedStoreKeys.slice( i );
        }
        // But truncate at first gap.
        var truncateAtFirstGap = !!i;

        for ( i = 0, l = added.length; i < l; i += 1 ) {
            var ref = added[i];
            var index = ref.index;
            var storeKey = ref.storeKey;
            j = removedStoreKeys.indexOf( storeKey );

            if ( j > -1 &&
                    removedIndexes[j] - j + addedIndexes.length === index ) {
                removedIndexes.splice( j, 1 );
                removedStoreKeys.splice( j, 1 );
            } else {
                addedIndexes.push( index );
                addedStoreKeys.push( storeKey );
            }
        }

        return {
            removedIndexes: removedIndexes,
            removedStoreKeys: removedStoreKeys,
            addedIndexes: addedIndexes,
            addedStoreKeys: addedStoreKeys,
            truncateAtFirstGap: truncateAtFirstGap,
            total: update.total !== undefined ?
                update.total :
                this.get( 'length' ) -
                    removedIndexes.length +
                    addedIndexes.length,
            upToId: update.upToId,
        };
    },

    _applyUpdate: function _applyUpdate ( args ) {
        var removedIndexes = args.removedIndexes;
        var removedStoreKeys = args.removedStoreKeys;
        var removedLength = removedStoreKeys.length;
        var addedIndexes = args.addedIndexes;
        var addedStoreKeys = args.addedStoreKeys;
        var addedLength = addedStoreKeys.length;
        var list = this._storeKeys;
        var recalculateFetchedWindows = !!( addedLength || removedLength );
        var oldLength = this.get( 'length' );
        var newLength = args.total;
        var firstChange = oldLength;
        var index, storeKey, listLength;

        // --- Remove items from list ---

        var l = removedLength;
        while ( l-- ) {
            index = removedIndexes[l];
            list.splice( index, 1 );
            if ( index < firstChange ) {
                firstChange = index;
            }
        }

        if ( args.truncateAtFirstGap ) {
            // Truncate the list so it does not contain any gaps; anything after
            // the first gap may be incorrect as a record may have been removed
            // from that gap.
            var i = 0;
            while ( list[i] ) {
                i += 1;
            }
            list.length = i;
            if ( i < firstChange ) {
                firstChange = i;
            }
        }

        // --- Add items to list ---

        // If the index is past the end of the array, you can't use splice
        // (unless you set the length of the array first), so use standard
        // assignment.
        listLength = list.length;
        for ( var i$1 = 0, l$1 = addedLength; i$1 < l$1; i$1 += 1 ) {
            index = addedIndexes[i$1];
            storeKey = addedStoreKeys[i$1];
            if ( index >= listLength ) {
                list[ index ] = storeKey;
                listLength = index + 1;
            } else {
                list.splice( index, 0, storeKey );
                listLength += 1;
            }
            if ( index < firstChange ) {
                firstChange = index;
            }
        }

        // --- Check upToId ---

        // upToId is the last item id the updates are to. Anything after here
        // may have changed, but won't be in the updates, so we need to truncate
        // the list to ensure it doesn't get into an inconsistent state.
        // If we can't find the id, we have to reset.
        if ( args.upToId ) {
            l = list.lastIndexOf( args.upToId ) + 1;
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
            query: this,
            removed: removedStoreKeys,
            removedIndexes: removedIndexes,
            added: addedStoreKeys,
            addedIndexes: addedIndexes,
        });

        // --- And process any waiting data packets ---

        this._applyWaitingPackets();

        return this;
    },

    _applyWaitingPackets: function _applyWaitingPackets () {
        var this$1 = this;

        var didDropPackets = false;
        var waitingPackets = this._waitingPackets;
        var l = waitingPackets.length;
        var queryState = this.get( 'queryState' );
        var packet;

        while ( l-- ) {
            packet = waitingPackets.shift();
            // If these values aren't now the same, the packet must
            // be OLDER than our current queryState, so just discard.
            if ( packet.queryState !== queryState ) {
                // But also fetch everything missing in observed range, to
                // ensure we have the required data
                didDropPackets = true;
            } else {
                this$1.sourceDidFetchIds( packet );
            }
        }
        if ( didDropPackets ) {
            this._fetchObservedWindows();
        }
    },

    _fetchObservedWindows: function _fetchObservedWindows () {
        var this$1 = this;

        var ranges = meta( this ).rangeObservers;
        var length = this.get( 'length' );
        var windowSize = this.get( 'windowSize' );
        var observerStart, observerEnd, firstWindow, lastWindow, range, l;
        if ( ranges ) {
            l = ranges.length;
            while ( l-- ) {
                range = ranges[l].range;
                observerStart = range.start || 0;
                observerEnd = 'end' in range ? range.end : length;
                if ( observerStart < 0 ) {
                    observerStart += length;
                }
                if ( observerEnd < 0 ) {
                    observerEnd += length;
                }
                firstWindow = Math.floor( observerStart / windowSize );
                lastWindow = Math.floor( ( observerEnd - 1 ) / windowSize );
                for ( ; firstWindow <= lastWindow; firstWindow += 1 ) {
                    this$1.fetchWindow( firstWindow, true );
                }
            }
        }
    },

    /**
        Method: O.WindowedQuery#clientDidGenerateUpdate

        Call this to update the list with what you think the server will do
        after an action has committed. The change will be applied immediately,
        making the UI more responsive, and be checked against what actually
        happened next time an update arrives. If it turns out to be wrong the
        list will be reset, but in most cases it should appear more efficient.

        removed - {String[]} The store keys of all records to delete.
        added   - {Object[]} A list of objects with index and storeKey
                  properties, in ascending order of index, for all records to be
                  inserted.

        Parameters:
            update - {Object} The removed/added updates to make.

        Returns:
            {O.WindowedQuery} Returns self.
    */
    clientDidGenerateUpdate: function clientDidGenerateUpdate ( update ) {
        update = this._normaliseUpdate( update );
        // Ignore completely any ids we don't have.
        update.truncateAtFirstGap = false;
        this._applyUpdate( update );
        this._preemptiveUpdates.push( update );
        this.set( 'status', this.get( 'status' ) | DIRTY );
        this.setObsolete();
        return this;
    },

    /**
        Method: O.WindowedQuery#sourceDidFetchUpdate

        The source should call this when it fetches a delta update for the
        query. The args object should contain the following properties:

        newQueryState - {String} The state this delta updates the remote query
                        to.
        oldQueryState - {String} The state this delta updates the remote query
                        from.
        removed  - {String[]} The ids of all records removed since
                   oldQueryState.
        added    - {{index: Number, id: String}[]} A list of { index, id }
                   objects, in ascending order of index, for all records added
                   since oldQueryState.
        upToId   - {String} (optional) As an optimisation, updates may only be
                   for the first portion of a list, up to a certain id. This is
                   the last id which is included in the range covered by the
                   updates; any information past this id must be discarded, and
                   if the id can't be found the list must be reset.
        total    - {Number} (optional) The total number of records in the list.

        Parameters:
            update - {Object} The delta update (see description above).

        Returns:
            {O.WindowedQuery} Returns self.
    */
    sourceDidFetchUpdate: function sourceDidFetchUpdate ( update ) {
        var queryState = this.get( 'queryState' );
        var status = this.get( 'status' );
        var preemptives = this._preemptiveUpdates;
        var preemptivesLength = preemptives.length;
        var allPreemptives, composed;

        // We've got an update, so we're no longer in the LOADING state.
        this.set( 'status', status & ~LOADING );

        // Check we've not already got this update.
        if ( queryState === update.newQueryState ) {
            if ( preemptivesLength && !( status & DIRTY ) ) {
                allPreemptives = preemptives.reduce( composeUpdates );
                this._applyUpdate( invertUpdate( allPreemptives ) );
                preemptives.length = 0;
            }
            return this;
        }
        // We can only update from our old query state.
        if ( queryState !== update.oldQueryState ) {
            return this.setObsolete();
        }
        // Set new query state
        this.set( 'queryState', update.newQueryState );

        // Map ids to store keys
        var toStoreKey = this.get( '_toStoreKey' );
        var added = update.added.map( function (item) { return ({
            index: item.index,
            storeKey: toStoreKey( item.id ),
        }); });
        var removed = update.removed.map( toStoreKey );
        var upToId = update.upToId && toStoreKey( update.upToId );
        var total = update.total;

        if ( !preemptivesLength ) {
            this._applyUpdate( this._normaliseUpdate({
                removed: removed,
                added: added,
                total: total,
                upToId: upToId,
            }));
        } else {
            // 1. Compose all preemptives:
            // [p1, p2, p3] -> [p1, p1 + p2, p1 + p2 + p3 ]
            composed = [ preemptives[0] ];
            for ( var i = 1; i < preemptivesLength; i += 1 ) {
                composed[i] = composeUpdates(
                    composed[ i - 1 ], preemptives[i] );
            }

            // 2. Normalise the update from the server. This is trickier
            // than normal, as we need to determine what the indexes of the
            // removed store keys were in the previous query state.
            var normalisedUpdate = {
                removedIndexes: [],
                removedStoreKeys: [],
                addedIndexes: added.map( function (item) { return item.index; } ),
                addedStoreKeys: added.map( function (item) { return item.storeKey; } ),
                truncateAtFirstGap: false,
                total: total,
                upToId: upToId,
            };

            // Find the removedIndexes for our update. If they were removed
            // in the composed preemptive, we have the index. Otherwise, we
            // need to search for the store key in the current list then
            // compose the result with the preemptive in order to get the
            // original index.
            var list = this._storeKeys;
            var removedIndexes = normalisedUpdate.removedIndexes;
            var removedStoreKeys = normalisedUpdate.removedStoreKeys;
            var _indexes = [];
            var _storeKeys = [];
            var wasSuccessfulPreemptive = false;
            var storeKey, index;

            allPreemptives = composed[ preemptivesLength - 1 ];
            for ( var i$1 = 0, l = removed.length; i$1 < l; i$1 += 1 ) {
                storeKey = removed[i$1];
                index = allPreemptives.removedStoreKeys.indexOf( storeKey );
                if ( index > -1 ) {
                    removedIndexes.push(
                        allPreemptives.removedIndexes[ index ] );
                    removedStoreKeys.push( storeKey );
                } else {
                    index = list.indexOf( storeKey );
                    if ( index > -1 ) {
                        _indexes.push( index );
                        _storeKeys.push( storeKey );
                    } else {
                        normalisedUpdate.truncateAtFirstGap = true;
                    }
                }
            }
            if ( _indexes.length ) {
                var x = composeUpdates( allPreemptives, {
                    removedIndexes: _indexes,
                    removedStoreKeys: _storeKeys,
                    addedIndexes: [],
                    addedStoreKeys: [],
                });
                _indexes = x.removedIndexes;
                _storeKeys = x.removedStoreKeys;
                var ll = removedIndexes.length;
                for ( var i$2 = 0, l$1 = _indexes.length; i$2 < l$1; i$2 += 1 ) {
                    removedIndexes[ ll ] = _indexes[i$2];
                    removedStoreKeys[ ll ] = _storeKeys[i$2];
                    ll += 1;
                }
            }
            sortLinkedArrays( removedIndexes, removedStoreKeys );

            // Now remove any idempotent operations
            var addedIndexes = normalisedUpdate.addedIndexes;
            var addedStoreKeys = normalisedUpdate.addedStoreKeys;
            var l$2 = addedIndexes.length;

            while ( l$2-- ) {
                storeKey = addedStoreKeys[l$2];
                var i$3 = removedStoreKeys.indexOf( storeKey );
                if ( i$3 > -1 &&
                        removedIndexes[i$3] - i$3 + l$2 === addedIndexes[l$2] ) {
                    removedIndexes.splice( i$3, 1 );
                    removedStoreKeys.splice( i$3, 1 );
                    addedIndexes.splice( l$2, 1 );
                    addedStoreKeys.splice( l$2, 1 );
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

            // If nothing actually changed in this update, we're done,
            // but we can apply any waiting packets.
            if ( !removedStoreKeys.length && !addedStoreKeys.length ) {
                wasSuccessfulPreemptive = true;
            } else {
                var l$3 = composed.length;
                while ( l$3-- ) {
                    if ( updateIsEqual(
                            normalisedUpdate, composed[l$3] ) ) {
                        // Remove the preemptives that have now been
                        // confirmed by the server
                        preemptives.splice( 0, l$3 + 1 );
                        wasSuccessfulPreemptive = true;
                        break;
                    }
                }
            }
            if ( wasSuccessfulPreemptive ) {
                // Truncate if needed
                if ( normalisedUpdate.truncateAtFirstGap ) {
                    var i$4 = 0;
                    while ( list[i$4] ) {
                        i$4 += 1;
                    }
                    if ( list.length !== i$4 ) {
                        list.length = i$4;
                        this.recalculateFetchedWindows( i$4 );
                    }
                }
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
    },

    /**
        Method: O.WindowedQuery#sourceDidFetchIds

        The source should call this when it fetches a portion of the id list for
        this query. The args object should contain:

        queryState - {String} The queryState of the server when this slice was
                     taken.
        ids        - {String[]} The list of ids.
        position   - {Number} The index in the query of the first id in ids.
        total      - {Number} The total number of records in the query.

        Parameters:
            args - {Object} The portion of the overall id list. See above for
                   details.

        Returns:
            {O.WindowedQuery} Returns self.
    */
    sourceDidFetchIds: function sourceDidFetchIds ( args ) {
        var queryState = this.get( 'queryState' );
        var status = this.get( 'status' );
        var oldLength = this.get( 'length' ) || 0;
        var canGetDeltaUpdates = this.get( 'canGetDeltaUpdates' );
        var position = args.position;
        var total = args.total;
        var ids = args.ids;
        var length = ids.length;
        var list = this._storeKeys;
        var windows = this._windows;
        var preemptives = this._preemptiveUpdates;
        var informAllRangeObservers = false;
        var beginningOfWindowIsFetched = true;

        // If the query state does not match, the list has changed since we last
        // queried it, so we must get the intervening updates first.
        if ( queryState && queryState !== args.queryState ) {
            if ( canGetDeltaUpdates ) {
                this._waitingPackets.push( args );
                return this.setObsolete().fetch();
            } else {
                list.length = windows.length = preemptives.length = 0;
                informAllRangeObservers = true;
            }
        }
        this.set( 'queryState', args.queryState );

        // Map ids to store keys
        var toStoreKey = this.get( '_toStoreKey' );
        var storeKeys = ids.map( toStoreKey );

        // Need to adjust for preemptive updates
        if ( preemptives.length ) {
            // Adjust store keys, position, length
            var allPreemptives = preemptives.reduce( composeUpdates );
            var addedIndexes = allPreemptives.addedIndexes;
            var addedStoreKeys = allPreemptives.addedStoreKeys;
            var removedIndexes = allPreemptives.removedIndexes;

            if ( canGetDeltaUpdates ) {
                var l = removedIndexes.length;
                while ( l-- ) {
                    var index = removedIndexes[l] - position;
                    if ( index < length ) {
                        if ( index >= 0 ) {
                            storeKeys.splice( index, 1 );
                            length -= 1;
                        } else {
                            position -= 1;
                        }
                    }
                }
                for ( var i = 0, l$1 = addedIndexes.length; i < l$1; i += 1 ) {
                    var index$1 = addedIndexes[i] - position;
                    if ( index$1 <= 0 ) {
                        position += 1;
                    } else if ( index$1 < length ) {
                        storeKeys.splice( index$1, 0, addedStoreKeys[i] );
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
        var end = position + length;

        // Insert store keys into list
        for ( var i$1 = 0; i$1 < length; i$1 += 1 ) {
            list[ position + i$1 ] = storeKeys[i$1];
        }

        // Have we fetched any windows?
        var windowSize = this.get( 'windowSize' );
        var windowIndex = Math.floor( position / windowSize );
        var withinWindowIndex = position % windowSize;
        if ( withinWindowIndex ) {
            for ( var i$2 = windowIndex * windowSize, l$2 = i$2 + withinWindowIndex;
                    i$2 < l$2; i$2 += 1  ) {
                if ( !list[i$2] ) {
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

    sourceWillFetchQuery: function sourceWillFetchQuery () {
        var this$1 = this;

        // If optimise and no longer observed -> remove request
        // Move from requested -> loading
        var windowSize = this.get( 'windowSize' );
        var windows = this._windows;
        var isAnExplicitIdFetch = this._isAnExplicitIdFetch;
        var indexOfRequested = this._indexOfRequested;
        var refreshRequested = this._refresh;
        var recordRequests = [];
        var idRequests = [];
        var optimiseFetching = this.get( 'optimiseFetching' );
        var ranges = ( meta( this ).rangeObservers || [] )
            .map( function (observer) { return observer.range; } );
        var fetchAllObservedIds = refreshRequested &&
                !this.get( 'canGetDeltaUpdates' );
        var prefetch = this.get( 'prefetch' );
        var status, inUse, rPrev, iPrev, start;

        this._isAnExplicitIdFetch = false;
        this._indexOfRequested = [];
        this._refresh = false;

        for ( var i = 0, l = windows.length; i < l; i += 1 ) {
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
                                count: windowSize,
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
                                count: windowSize,
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
                            count: windowSize,
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
                this$1._windows = this$1._windows.map(
                    function (status) { return status & ~(WINDOW_LOADING|WINDOW_RECORDS_LOADING); }
                );
                this$1.set( 'status', this$1.get( 'status' ) & ~LOADING );
            },
        };
    },
});

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

var attributeErrorsObserver = {
    object: null,
    method: 'notifyAttributeErrors',
};
var addValidityObserver = function ( observers, propKey ) {
    var keyObservers = observers[ propKey ];
    if ( keyObservers && keyObservers.contains( attributeErrorsObserver ) ) {
        return;
    }
    if ( !observers.hasOwnProperty( propKey ) ) {
        keyObservers = observers[ propKey ] = keyObservers ?
            keyObservers.slice() : [];
    }
    keyObservers.push( attributeErrorsObserver );
};

/**
    Class: O.RecordAttribute

    Represents an attribute on a record.
*/
var RecordAttribute = Class({

    __setupProperty__: function __setupProperty__ ( metadata, propKey, object ) {
        var constructor = object.constructor;
        var attrs = metadata.attrs;
        var dependents, observers, dependencies, l, key, AttributeErrorsType;
        if ( !metadata.hasOwnProperty( 'attrs' ) ) {
            attrs = metadata.attrs = attrs ? Object.create( attrs ) : {};
        }
        if ( this.isPrimaryKey ) {
            constructor.primaryKey = propKey;
            // Make the `id` property depend on the primary key.
            dependents = metadata.dependents;
            if ( !metadata.hasOwnProperty( 'dependents' ) ) {
                dependents = metadata.dependents = clone( dependents );
                metadata.allDependents = {};
            }
            ( dependents[ propKey ] ||
                ( dependents[ propKey ] = [] ) ).push( 'id' );
        }
        attrs[ this.key || propKey ] = propKey;
        constructor.clientSettableAttributes = null;

        if ( this.validate ) {
            observers = metadata.observers;
            addValidityObserver( observers, propKey );

            dependencies = this.validityDependencies;
            if ( dependencies ) {
                AttributeErrorsType = object.AttributeErrorsType;
                if ( AttributeErrorsType.forRecordType !== constructor ) {
                    AttributeErrorsType = object.AttributeErrorsType =
                        Class({
                            Extends: AttributeErrorsType,
                        });
                    AttributeErrorsType.forRecordType = constructor;
                    metadata = meta( AttributeErrorsType.prototype );
                    dependents = metadata.dependents =
                        clone( metadata.dependents );
                } else {
                    metadata = meta( AttributeErrorsType.prototype );
                    dependents = metadata.dependents;
                }
                l = dependencies.length;
                while ( l-- ) {
                    key = dependencies[l];
                    if ( !dependents[ key ] ) {
                        dependents[ key ] = [];
                        addValidityObserver( observers, key );
                    }
                    dependents[ key ].push( propKey );
                }
            }
        }
    },

    __teardownProperty__: function __teardownProperty__ ( metadata, propKey, object ) {
        var attrs = metadata.attrs;
        if ( !metadata.hasOwnProperty( 'attrs' ) ) {
            attrs = metadata.attrs = Object.create( attrs );
        }
        attrs[ this.key || propKey ] = null;
        object.constructor.clientSettableAttributes = null;
    },

    /**
        Constructor: O.RecordAttribute

        Parameters:
            mixin - {Object} (optional) Override the default properties.
    */
    init: function init ( mixin$$1 ) {
        Object.assign( this, mixin$$1 );
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
    willSet: function willSet ( propValue, propKey, record ) {
        if ( !record.get( 'isEditable' ) ) {
            return false;
        }
        if ( propValue === null ) {
            if ( !this.isNullable ) {
                return false;
            }
        } else if ( this.Type && !instanceOf( propValue, this.Type ) ) {
            throw new Error(
                'Incorrect value type for record attribute: \n' +
                'key: ' + propKey + '\n' +
                'value: ' + propValue
            );
        }
        return true;
    },

    /**
        Property: O.RecordAttribute#toJSON
        Type: *
        Default: null|(*,String,O.Record)->*

        If set, this function will be used to convert the property to a
        JSON-compatible representation. The function will be called as a method
        on the RecordAttribute object, and passed the following arguments:

        propValue - {*} The value to convert.
        propKey   - {String} The name of the attribute.
        record    - {O.Record} The record the attribute is being set on or
                    got from.
    */
    toJSON: null,

    /**
        Property: O.RecordAttribute#defaultValue
        Type: *
        Default: undefined

        If the attribute is not set on the underlying data object, the
        defaultValue will be used as the attribute instead. This will also be
        used to add this attribute to the data object if a new record is
        created and the attribute is not set.

        The value should be the JSON encoding of the type specified in
        <O.RecordAttribute#Type>.
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

        Other properties the validity depends on. The attribute will be
        revalidated if any of these properties change. Note, chained
        dependencies are not automatically calculated; you must explicitly state
        all dependencies.

        NB. This is a list of the names of the properties as used on the
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
    call: function call ( record, propValue, propKey ) {
        var store = record.get( 'store' );
        var storeKey = record.get( 'storeKey' );
        var data = storeKey ? store.getData( storeKey ) : record._data;
        var attrKey = this.key || propKey;
        var Type = this.Type;
        var currentAttrValue, attrValue, update;
        if ( data ) {
            currentAttrValue = data[ attrKey ];
            if ( currentAttrValue === undefined ) {
                currentAttrValue = this.defaultValue;
            }
            if ( propValue !== undefined &&
                    this.willSet( propValue, propKey, record ) ) {
                if ( this.toJSON ) {
                    attrValue = this.toJSON( propValue, propKey, record );
                } else if ( propValue && propValue.toJSON ) {
                    attrValue = propValue.toJSON();
                } else {
                    attrValue = propValue;
                }
                if ( !isEqual( attrValue, currentAttrValue ) ) {
                    // May have changed if willSet moved the account this record
                    // is in.
                    storeKey = record.get( 'storeKey' );
                    if ( storeKey ) {
                        update = {};
                        update[ attrKey ] = attrValue;
                        store.updateData( storeKey, update,
                            !( this.noSync || record._noSync ) );
                        store.fire( 'record:user:update', { record: this } );
                    } else {
                        data[ attrKey ] = attrValue;
                        record.computedPropertyDidChange( propKey );
                    }
                }
                return propValue;
            }
        } else {
            currentAttrValue = this.defaultValue;
        }
        return currentAttrValue !== null && Type && Type.fromJSON ?
            Type.fromJSON( currentAttrValue ) : currentAttrValue;
    },
});

/**
    Class: O.AttributeErrors

    Extends: O.Object

    Maintains the state of the validity of each attribute on a record.
*/
var AttributeErrors = Class({

    Extends: Obj,

    /**
        Property: O.AttributeErrors#errorCount
        Type: Number

        The number of attributes on the record in an error state.
    */

    /**
        Constructor: O.AttributeErrors

        Parameters:
            record - {O.Record} The record to manage attribute errors for.
    */
    init: function init ( record ) {
        var this$1 = this;

        AttributeErrors.parent.constructor.call( this );

        var attrs = meta( record ).attrs;
        var errorCount = 0;
        var attrKey, propKey, attribute, error;

        for ( attrKey in attrs ) {
            // Check if attribute has been removed (e.g. in a subclass).
            if ( propKey = attrs[ attrKey ] ) {
                // Validate current value and set error on this object.
                attribute = record[ propKey ];
                error = this$1[ propKey ] = attribute.validate ?
                    attribute
                        .validate( record.get( propKey ), propKey, record ) :
                    null;

                // Keep an error count
                if ( error ) {
                    errorCount += 1;
                }
            }
        }

        this.errorCount = errorCount;
        this._record = record;
    },

    /**
        Method: O.AttributeErrors#recordPropertyDidChange

        Called when a property changes which affects the validation
        of an attribute.

        Parameters:
            _    - {*} Unused.
            property - {String} The name of the property which has changed.
    */
    recordPropertyDidChange: function recordPropertyDidChange ( _, property ) {
        var this$1 = this;

        var metadata = meta( this );
        var changed = metadata.changed = {};
        var dependents = metadata.dependents[ property ];
        var l = dependents ? dependents.length : 0;
        var record = this._record;
        var i, propKey, attribute;

        this.beginPropertyChanges();
        for ( i = 0; i <= l; i += 1 ) {
            if ( i === l ) {
                propKey = property;
            } else {
                propKey = dependents[i];
            }
            attribute = record[ propKey ];
            if ( changed[ propKey ] ||
                    !( attribute instanceof RecordAttribute ) ) {
                continue;
            }
            changed[ propKey ] = {
                oldValue: this$1[ propKey ],
                newValue: this$1[ propKey ] = ( attribute.validate ?
                  attribute.validate( record.get( propKey ), propKey, record ) :
                  null ),
            };
        }
        this.endPropertyChanges();
    },

    /**
        Method: O.AttributeErrors#setRecordValidity

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
                } else if ( isValid && !wasValid ) {
                    errorCount -= 1;
                }
            }
        }
        this.set( 'errorCount', errorCount )
            ._record.set( 'isValid', !errorCount );
    }.observes( '*' ),
});

var ToOneAttribute = Class({

    Extends: RecordAttribute,

    // Referenced record may be garbage collected independently of this record,
    // so always ask store for the value.
    isVolatile: true,

    willSet: function willSet ( propValue, propKey, record ) {
        if ( ToOneAttribute.parent.willSet.call(
                this, propValue, propKey, record ) ) {
            if ( record.get( 'storeKey' ) &&
                    propValue && !propValue.get( 'storeKey' ) ) {
                throw new Error( 'O.ToOneAttribute: ' +
                    'Cannot set connection to record not saved to store.' );
            }
            return true;
        }
        return false;
    },

    call: function call ( record, propValue, propKey ) {
        var result = ToOneAttribute.parent.call.call(
            this, record, propValue, propKey );
        if ( result && typeof result === 'string' ) {
            result = record.get( 'store' ).getRecordFromStoreKey( result );
        }
        return result || null;
    },
});

var READY_NEW_DIRTY = (READY|NEW|DIRTY);

/**
    Class: O.Record

    Extends: O.Object

    All data object classes managed by the store must inherit from Record. This
    provides the basic status management for the attributes.
*/
var Record = Class({

    Extends: Obj,

    /**
        Constructor: O.Record

        Parameters:
            store    - {Store} The store to link to this record.
            storeKey - {String} (optional) The unique id for this record in the
                       store. If ommitted, a new record will be created, which
                       can then be committed to the store using the
                       <O.Record#saveToStore> method.
    */
    init: function init ( store, storeKey ) {
        this._noSync = false;
        this._data = storeKey ? null : {
            accountId: store.getDefaultAccountId( this.constructor ),
        };
        this.store = store;
        this.storeKey = storeKey;

        Record.parent.constructor.call( this );
    },

    nextEventTarget: function () {
        return this.get( 'store' );
    }.property().nocache(),

    /**
        Method: O.Record#clone

        Creates a new instance of the record with the same attributes. Does
        not call <O.Record#saveToStore>.

        Parameters:
            store - {O.Store} The store to create the record in.

        Returns:
            {O.Record} The new record.
    */
    clone: function clone$$1 ( store ) {
        var this$1 = this;

        var Type = this.constructor;
        var prototype = Type.prototype;
        var clone$$1 = new Type( store );
        var attrs = meta( this ).attrs;
        var attrKey, propKey, value;
        clone$$1.set( 'accountId', this.get( 'accountId' ) );
        for ( attrKey in attrs ) {
            propKey = attrs[ attrKey ];
            if ( prototype[ propKey ].noSync ) {
                continue;
            }
            value = this$1.get( propKey );
            if ( value instanceof Record ) {
                value = value.getDoppelganger( store );
            }
            if ( value !== undefined ) {
                clone$$1.set( propKey, value );
            }
        }

        return clone$$1;
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

    // ---

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
    is: function is ( state ) {
        return !!( this.get( 'status' ) & state );
    },

    /**
        Method: O.Record#setObsolete

        Adds <O.Status.OBSOLETE> to the current status value.

        Returns:
            {O.Record} Returns self.
    */
    setObsolete: function setObsolete () {
        var storeKey = this.get( 'storeKey' );
        var status = this.get( 'status' );
        if ( storeKey ) {
            this.get( 'store' ).setStatus( storeKey, status | OBSOLETE );
        }
        return this;
    },

    /**
        Method: O.Record#setLoading

        Adds <O.Status.LOADING> to the current status value.

        Returns:
            {O.Record} Returns self.
    */
    setLoading: function setLoading () {
        var storeKey = this.get( 'storeKey' );
        var status = this.get( 'status' );
        if ( storeKey ) {
            this.get( 'store' ).setStatus( storeKey, status | LOADING );
        }
        return this;
    },

    // ---

    /**
        Property: O.Record#id
        Type: String

        The record id. It's fine to override this with an attribute, provided it
        is the primary key. If the primary key for the record is not called
        'id', you must not override this property.
    */
    id: function ( id ) {
        var storeKey = this.get( 'storeKey' );
        var primaryKey = this.constructor.primaryKey || 'id';
        if ( id !== undefined ) {
            if ( storeKey ) {
                RunLoop.didError({
                    name: 'O.Record#id',
                    message: 'Cannot change immutable property',
                });
            } else if ( primaryKey === 'id' ) {
                this._data.id = id;
            } else {
                this.set( primaryKey, id );
            }
        }
        return storeKey ?
            this.get( 'store' ).getIdFromStoreKey( storeKey ) :
            this._data[ primaryKey ];
    }.property( 'accountId' ),

    toJSON: function toJSON () {
        return this.get( 'storeKey' ) || this;
    },

    toIdOrStoreKey: function toIdOrStoreKey () {
        return this.get( 'id' ) || ( '#' + this.get( 'storeKey' ) );
    },

    accountId: function ( toAccountId ) {
        var storeKey = this.get( 'storeKey' );
        var store = this.get( 'store' );
        var accountId = storeKey ?
                store.getAccountIdFromStoreKey( storeKey ) :
                this._data.accountId;
        if ( toAccountId !== undefined && toAccountId !== accountId ) {
            if ( this.get( 'status' ) === READY_NEW_DIRTY ) {
                if ( storeKey ) {
                    store.updateData( storeKey, {
                        accountId: toAccountId,
                    }, true );
                } else {
                    this._data.accountId = toAccountId;
                }
            } else {
                store.moveRecord( storeKey, toAccountId );
            }
            accountId = toAccountId;
            store.fire( 'record:user:update', { record: this } );
        }
        return accountId;
    }.property(),

    /**
        Method: O.Record#saveToStore

        Saves the record to the store. Will then be committed back by the store
        according to the store's policy. Note, only a record not currently
        created in its store can do this; an error will be thrown if this method
        is called for a record already created in the store.

        Returns:
            {O.Record} Returns self.
    */
    saveToStore: function saveToStore () {
        var this$1 = this;

        if ( this.get( 'storeKey' ) ) {
            throw new Error( 'Record already created in store.' );
        }
        var Type = this.constructor;
        var data = this._data;
        var store = this.get( 'store' );
        var accountId = this.get( 'accountId' );
        var idPropKey = Type.primaryKey || 'id';
        var idAttrKey = this[ idPropKey ].key || idPropKey;
        var storeKey =
            store.getStoreKey( accountId, Type, data[ idAttrKey ] );
        var attrs = meta( this ).attrs;

        this._data = null;

        // Fill in any missing defaults + toOne attributes to previously
        // uncreated records
        for ( var attrKey in attrs ) {
            var propKey = attrs[ attrKey ];
            if ( propKey ) {
                var attribute = this$1[ propKey ];
                if ( !( attrKey in data ) ) {
                    var defaultValue = attribute.defaultValue;
                    if ( defaultValue !== undefined ) {
                        data[ attrKey ] = clone( defaultValue );
                    }
                } else if ( ( attribute instanceof ToOneAttribute ) &&
                        ( data[ attrKey ] instanceof Record ) ) {
                    data[ attrKey ] = data[ attrKey ].toJSON();
                }
            }
        }

        // Save to store
        store.createRecord( storeKey, data )
             .setRecordForStoreKey( storeKey, this );

        // And save store reference on record instance.
        this.set( 'storeKey', storeKey );

        // Fire event
        store.fire( 'record:user:create', { record: this } );

        return this;
    },

    /**
        Method: O.Record#discardChanges

        Reverts the attributes in the record to the last committed state. If
        the record has never been committed, this will destroy the record.

        Returns:
            {O.Record} Returns self.
    */
    discardChanges: function discardChanges () {
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
        Method: O.Record#fetch

        Fetch/refetch the data from the source. Will have no effect if the
        record is new or already loading.

        Returns:
            {O.Record} Returns self.
    */
    fetch: function fetch () {
        var storeKey = this.get( 'storeKey' );
        if ( storeKey ) {
            this.get( 'store' ).fetchData( storeKey );
        }
        return this;
    },

    /**
        Method: O.Record#destroy

        Destroy the record. This will inform the store, which will commit it to
        the source.
    */
    destroy: function destroy () {
        var storeKey = this.get( 'storeKey' );
        if ( storeKey && this.get( 'isEditable' ) ) {
            this.get( 'store' )
                .destroyRecord( storeKey )
                .fire( 'record:user:destroy', { record: this } );
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
    getDoppelganger: function getDoppelganger ( store ) {
        if ( this.get( 'store' ) === store ) {
            return this;
        }
        return store.materialiseRecord( this.get( 'storeKey' ) );
    },

    /**
        Method: O.Record#getData

        Returns:
            {Object} The raw data hash in the store for this object.
    */
    getData: function getData () {
        return this._data ||
            this.get( 'store' ).getData( this.get( 'storeKey' ) );
    },

    /**
        Method: O.Record#storeWillUnload

        This should only be called by the store, when it unloads the record's
        data to free up memory.
    */
    storeWillUnload: function storeWillUnload () {
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
    stopSync: function stopSync () {
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
    startSync: function startSync () {
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

    // ---

    AttributeErrorsType: AttributeErrors,

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
    errorToSet: function errorToSet ( key, value ) {
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
        var AttributeErrorsType = this.get( 'AttributeErrorsType' );
        return new AttributeErrorsType( this );
    }.property(),

    /**
        Method: O.Record#notifyAttributeErrors
    */
    notifyAttributeErrors: function notifyAttributeErrors ( _, propKey ) {
        var attributeErrors = meta( this ).cache.errorForAttribute;
        if ( attributeErrors ) {
            attributeErrors.recordPropertyDidChange( this, propKey );
        }
    },
});

Record.getClientSettableAttributes = function ( Type ) {
    var clientSettableAttributes = Type.clientSettableAttributes;
    var prototype, attrs, attrKey, propKey, attribute;
    if ( !clientSettableAttributes ) {
        prototype = Type.prototype;
        attrs = meta( prototype ).attrs;
        clientSettableAttributes = {};
        for ( attrKey in attrs ) {
            propKey = attrs[ attrKey ];
            if ( propKey ) {
                attribute = prototype[ propKey ];
                if ( !attribute.noSync ) {
                    clientSettableAttributes[ attrKey ] = true;
                }
            }
        }
        Type.clientSettableAttributes = clientSettableAttributes;
    }
    return clientSettableAttributes;
};

/**
    Property: O.Record.primaryKey
    Type: String

    Set automatically by the O.RecordAttribute with `isPrimaryKey: true`. If
    no primary key is set, there is presumed to be a property called "id"
    that is the primary key.
*/

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
Record.attr = function ( Type, mixin$$1 ) {
    if ( !mixin$$1 ) {
        mixin$$1 = {};
    }
    if ( Type && !mixin$$1.Type ) {
        mixin$$1.Type = Type;
    }
    return new RecordAttribute( mixin$$1 );
};

Record.toOne = function ( mixin$$1 ) {
    return new ToOneAttribute( mixin$$1 );
};

var slice$4 = Array.prototype.slice;

// ---

/**
    Method: O.Record#notifyRecordArray

    Parameters:
        _       - Unused
        propKey - The propKey that changed on the

    If true, any changes to the record will not be committed to the source.
*/
Record.prototype.notifyRecordArray = function ( _, propKey ) {
    var recordArray = this[ '_' + propKey + 'RecordArray' ];
    var isInCache = propKey in meta( this ).cache;
    // If it's already been updated due to a fetch to the property,
    // the array will be in the cache. Don't waste time calling again.
    if ( recordArray && !isInCache ) {
        recordArray.updateFromRecord();
    }
};

var mapToTrue = function ( result, key ) {
    result[ key ] = true;
    return result;
};

// ---

var RecordArray$2 = Class({

    Extends: ObservableArray,

    init: function init ( record, propKey, Type ) {
        this.record = record;
        this.propKey = propKey;
        this.Type = Type;
        this.store = record.get( 'store' );

        this._updatingStore = false;

        RecordArray$2.parent.constructor.call( this );
    },

    toJSON: function toJSON () {
        return this._array.slice();
    },

    updateFromRecord: function updateFromRecord () {
        if ( !this._updatingStore ) {
            var record = this.get( 'record' );
            var propKey = this.get( 'propKey' );
            var list = record[ propKey ].getRaw( record, propKey );
            if ( !list ) {
                list = [];
            } else if ( record[ propKey ].Type === Object ) {
                list = Object.keys( list );
                list.sort();
            } else {
                list = list.slice();
            }

            this.set( '[]', list );
        }
    },

    getObjectAt: function getObjectAt ( index ) {
        var storeKey = RecordArray$2.parent.getObjectAt.call( this, index );
        return storeKey ?
            this.get( 'store' ).getRecordFromStoreKey( storeKey ) :
            null;
    },

    setObjectAt: function setObjectAt ( index, value ) {
        this.replaceObjectsAt( index, 1, [ value ] );
        return this;
    },

    replaceObjectsAt: function replaceObjectsAt ( index, numberRemoved, newItems ) {
        newItems = newItems ? slice$4.call( newItems ) : [];

        var record = this.get( 'record' );
        var propKey = this.get( 'propKey' );
        var store = this.get( 'store' );
        var oldItems = RecordArray$2.parent.replaceObjectsAt.call(
                this, index, numberRemoved, newItems.map( function ( record ) {
                    return record.get( 'storeKey' );
                })
            ).map( function ( storeKey ) {
                return store.getRecordFromStoreKey( storeKey );
            });
        var value = this._array;

        this._updatingStore = true;
        if ( record[ propKey ].Type === Object ) {
            value = value.reduce( mapToTrue, {} );
        } else {
            value = value.slice();
        }
        record[ propKey ].setRaw( record, propKey, value );
        this._updatingStore = false;

        return oldItems;
    },

    add: function add ( record ) {
        var index = this._array.indexOf( record.get( 'storeKey' ) );
        if ( index === -1 ) {
            this.replaceObjectsAt(
                this.get( 'length' ), 0, [ record ] );
        }
        return this;
    },

    remove: function remove ( record ) {
        var index = this._array.indexOf( record.get( 'storeKey' ) );
        if ( index > -1 ) {
            this.replaceObjectsAt( index, 1 );
        }
        return this;
    },
});

// ---


var notifyRecordArrayObserver = {
    object: null,
    method: 'notifyRecordArray',
};

var ToManyAttribute = Class({

    Extends: RecordAttribute,

    __setupProperty__: function __setupProperty__ ( metadata, propKey, object ) {
        ToManyAttribute.parent
            .__setupProperty__.call( this, metadata, propKey, object );
        var observers = metadata.observers;
        var keyObservers = observers[ propKey ];
        if ( !observers.hasOwnProperty( propKey ) ) {
            keyObservers = observers[ propKey ] = keyObservers ?
                keyObservers.slice() : [];
        }
        keyObservers.push( notifyRecordArrayObserver );
    },

    __teardownProperty__: function __teardownProperty__ ( metadata, propKey, object ) {
        ToManyAttribute.parent
            .__teardownProperty__.call( this, metadata, propKey, object );
        var observers = metadata.observers;
        var keyObservers = observers[ propKey ];
        if ( !observers.hasOwnProperty( propKey ) ) {
            keyObservers = observers[ propKey ] = keyObservers.slice();
        }
        keyObservers.erase( notifyRecordArrayObserver );
    },

    Type: Array,
    recordType: null,

    call: function call ( record, propValue, propKey ) {
        var arrayKey = '_' + propKey + 'RecordArray';
        var recordArray = record[ arrayKey ];
        if ( !recordArray ) {
            recordArray = record[ arrayKey ] =
                new RecordArray$2( record, propKey, this.recordType );
        }
        // Race condition: another observer may fetch this before
        // our notifyRecordArray method has been called.
        recordArray.updateFromRecord();
        if ( propValue !== undefined ) {
            recordArray
                .replaceObjectsAt( 0,
                    recordArray.get( 'length' ),
                    propValue.map( function (x) { return x; } )
                );
        }
        return recordArray;
    },

    getRaw: function getRaw ( record, propKey ) {
        return ToManyAttribute.parent.call.call(
            this, record, undefined, propKey );
    },

    setRaw: function setRaw ( record, propKey, data ) {
        return ToManyAttribute.parent.call.call(
            this, record, data, propKey );
    },
});

Record.toMany = function ( mixin$$1 ) {
    return new ToManyAttribute( mixin$$1 );
};

// ---

var HANDLE_ALL_ERRORS = Symbol( 'HANDLE_ALL_ERRORS' );
var HANDLE_NO_ERRORS = [];

/**
    Class: O.RecordResult

    This class allows you to observe the result of fetching or committing a
    record.

    This class if used directly deals in callbacks; you should probably only
    ever instantiate it via <O.Record#ifSuccess> or <O.Record#getResult> which
    provide Promise interfaces. See those two functions for usage examples.

    The object waits for the record to transition into a READY, DESTROYED or
    NON_EXISTENT state, then calls the callback.

    When an error is “caught” (that is, error propagation is stopped), the
    changes in the store are not reverted.
*/
var RecordResult = Class({

    /**
        Property: O.RecordResult#error
        Type: {O.Event|null}

        Set for any commit error that occurs (whether a handled error or not).
    */

    /**
        Property: O.RecordResult#record
        Type: {O.Record}

        The record being observed
    */

    init: function init ( record, callback, mixin$$1 ) {
        this._callback = callback;

        this.record = record;
        this.error = null;

        record
            .on( 'record:commit:error', this, 'onError' )
            .addObserverForKey( 'status', this, 'statusDidChange' );

        Object.assign( this, mixin$$1 );
        this.statusDidChange( record, 'status', 0, record.get( 'status' ) );
    },

    done: function done () {
        this.record
            .removeObserverForKey( 'status', this, 'statusDidChange' )
            .off( 'record:commit:error', this, 'onError' );
        this._callback( this );
    },

    statusDidChange: function statusDidChange ( record, key, _, newStatus ) {
        if ( !( newStatus & (EMPTY|NEW|DIRTY|COMMITTING) ) ) {
            this.done();
        }
    },

    onError: function onError ( event ) {
        this.error = event;
        if ( this.shouldStopErrorPropagation( event ) ) {
            event.stopPropagation();
        }
        this.done();
    },

    /**
        Property: O.RecordResult#handledErrorTypes
        Type: {Array<string>|HANDLE_NO_ERRORS|HANDLE_ALL_ERRORS}
        Default: HANDLE_NO_ERRORS

        Either one of the two constants (available on the RecordResult
        constructor), or an array of error types to handle, e.g.
        `[ 'alreadyExists' ]`. (Where “handle” means “stop propagation on”.)
    */
    handledErrorTypes: HANDLE_NO_ERRORS,

     /**
        Method: O.RecordResult#shouldStopErrorPropagation

        Parameters:
            event - {O.Event} The commit error object.

        When an error occurs, should its propagation be stopped? If propagation
        is stopped, the changes will not be reverted in the store, and the
        crafter of the RecordResult is responsible for resolving the state in
        the store.

        Instances should normally be able to set `handledErrorTypes`, but if
        more complex requirements come up this method can also be overridden.

        Returns:
            {Boolean} Stop propagation of the event?
    */
    shouldStopErrorPropagation: function shouldStopErrorPropagation ( event ) {
        var handledErrorTypes = this.handledErrorTypes;
        return handledErrorTypes !== HANDLE_NO_ERRORS &&
            ( handledErrorTypes === HANDLE_ALL_ERRORS ||
                handledErrorTypes.indexOf( event.type ) !== -1 );
    },
});
RecordResult.HANDLE_ALL_ERRORS = HANDLE_ALL_ERRORS;
RecordResult.HANDLE_NO_ERRORS = HANDLE_NO_ERRORS;

// ---

Object.assign( Record.prototype, {
    /*
        Function: O.Record#getResult
        Returns: {Promise<O.RecordResult>}

        The promise it returns will resolve to a RecordResult which has two
        notable properties, `record` and `error`.

        Normally, <O.Record#ifSuccess> will be easier to use, but if you’re
        working with batch processing of objects and Promise.all(), then you’ll
        want to use getResult rather than ifSuccess, because Promise.all() will
        reject with the first error it receives, whereas in such a situation
        you’ll want instead to produce an array of errors.

        Usage:

            record
                .set( … )  // Or anything that makes it commit changes.
                .getResult({
                    handledErrorTypes: [ 'somethingWrong' ],
                })
                .then( result => {
                    if ( result.error ) {
                        // Do something with the somethingWrong error
                    }
                });
    */
    getResult: function getResult ( mixin$$1 ) {
        var this$1 = this;

        return new Promise( function (resolve) { return new RecordResult( this$1, resolve, mixin$$1 ); }
        );
    },

    /*
        Function: O.Record#ifSuccess
        Returns: {Promise<O.Record, O.RecordResult>}

        The promise it returns will either resolve to the record, or be rejected
        with a RecordResult, which is an object containing two properties to
        care about, `record` and `error`.

        (Why the name ifSuccess? Read it as “set this field; if success, then do
        such-and-such, otherwise catch so-and-so.)

        Usage for catching failed commits:

            record
                .set( … )  // Or anything that makes it commit changes.
                .ifSuccess({
                    handledErrorTypes: [ 'somethingWrong' ],
                })
                .then( record => {
                    // Do something after the commit has finished
                })
                .catch( ({ record, error }) => {
                    // Do something with the somethingWrong error
                });

        Or for loading a record that may or may not exist:

            store
                .getRecord( null, Foo, 'id' )
                .ifSuccess()
                    .then( record => {
                        // record loaded
                    })
                    .catch( ({ record }) => {
                        // record didn't load
                    })

    */
    ifSuccess: function ifSuccess ( mixin$$1 ) {
        var this$1 = this;

        return new Promise( function ( resolve, reject ) { return new RecordResult( this$1, function (result) {
                var record = result.record;
                if ( result.error || record.is( NON_EXISTENT ) ) {
                    reject( result );
                } else {
                    resolve( record );
                }
            }, mixin$$1 ); }
        );
    },
});

/**
    Class: O.ValidationError

    Represents an error in an attribute value of a record.

    Parameters:
        type        - {Number} The error code.
        explanation - {String} A description of the error (normally used to
                      present to the user).
*/
var ValidationError = function ValidationError ( type, explanation ) {
    this.type = type;
    this.explanation = explanation;
};

ValidationError.REQUIRED = 1;
ValidationError.TOO_SHORT = 2;
ValidationError.TOO_LONG = 4;
ValidationError.INVALID_CHAR = 8;
ValidationError.FIRST_CUSTOM_ERROR = 16;

/**
    Class: O.Source

    Extends: O.Object

    A source provides persistent storage for a set of records. Data is fetched
    and commited back to here by an instance of <O.Store>.
*/
var Source = Class({

    Extends: Obj,

    // ---

    /**
        Method: O.Source#fetchRecord

        Fetches a particular record from the source

        Parameters:
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            id        - {String} The record id.
            callback  - {Function} (optional) A callback to make after the
                       record fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecord: function fetchRecord (/* accountId, Type, id, callback */) {
        return false;
    },

    /**
        Method: O.Source#fetchAllRecords

        Fetches all records of a particular type from the source. If a state
        token is supplied, the server may, if it is able to, only return the
        changes since that state.

        Parameters:
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            state     - {(String|undefined)} The current state in the store.
            callback  - {Function} (optional) A callback to make after the
                        record fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchAllRecords: function fetchAllRecords (/* accountId, Type, state, callback */) {
        return false;
    },

    /**
        Method: O.Source#refreshRecord

        Fetches any new data for a previously fetched record. If not overridden,
        this method just calls <O.Source#fetchRecord>.

        Parameters:
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            id        - {String} The record id.
            callback  - {Function} (optional) A callback to make after the
                        record refresh completes (successfully or
                        unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the refresh.
    */
    refreshRecord: function refreshRecord ( accountId, Type, id, callback ) {
        return this.fetchRecord( accountId, Type, id, callback );
    },

    /**
        Method: O.Source#fetchQuery

        Fetches the data for a remote query from the source.

        Parameters:
            query - {O.Query} The query to fetch.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchQuery: function fetchQuery (/* query, callback */) {
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
                    Type,
                    accountId,
                    primaryKey,
                    create: {
                        storeKeys: [ "sk1", "sk2" ],
                        records: [{ attr: val, attr2: val2 ...}, {...}]
                    },
                    update: {
                        storeKeys: [ "sk3", "sk4", ... ],
                        records: [{ id: "id3", attr: val ... }, {...}],
                        changes: [{ attr: true }, ... ]
                    },
                    moveFromAccount: {
                        previousAccountId: ... same as update ...
                        ...
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

        Parameters:
            changes  - {Object} The creates/updates/destroys to commit.
            callback - {Function} (optional) A callback to make after the
                       changes have been committed.

        Returns:
            {Boolean} Returns true if any of the types were handled. The
            callback will only be called if the source is handling at least one
            of the types being committed.
    */
    commitChanges: function commitChanges (/* changes, callback */) {
        return false;
    },
});

/**
    Class: O.AggregateSource

    An O.AggregateSource instance can be used to collect several <O.Source>
    instances together to present to an instance of <O.Store>. Each method call
    on an aggregate source is passed around the sources it is managing until it
    finds one that can handle it.
*/
var AggregateSource = Class({

    Extends: Source,

    init: function init (/* ...mixins */) {
        this.sources = [];
        AggregateSource.parent.constructor.apply( this, arguments );
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
    addSource: function addSource ( source ) {
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
    removeSource: function removeSource ( source ) {
        this.get( 'sources' ).erase( source );
        return this;
    },

    storeWasSet: function () {
        var store = this.get( 'store' );
        this.sources.forEach( function ( source ) {
            source.set( 'store', store );
        });
    }.observes( 'store' ),

    fetchRecord: function fetchRecord ( accountId, Type, id, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.fetchRecord( accountId, Type, id, callback );
        });
    },

    fetchAllRecords: function fetchAllRecords ( accountId, Type, state, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.fetchAllRecords( accountId, Type, state, callback );
        });
    },

    refreshRecord: function refreshRecord ( accountId, Type, id, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.refreshRecord( accountId, Type, id, callback );
        });
    },

    commitChanges: function commitChanges ( changes, callback ) {
        var waiting = 0;
        var callbackAfterAll;
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

    fetchQuery: function fetchQuery ( query, callback ) {
        return this.get( 'sources' ).some( function ( source ) {
            return source.fetchQuery( query, callback );
        });
    },
});

/**
    Class: O.MemoryManager

    A MemoryManager instance periodically checks the store to ensure it doesn't
    have beyond a certain number of records in memory. If it does, the least
    recently used records are removed until the limit has no longer been
    breached.
*/

var MemoryManager = Class({

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
        - Type: The constructor for the Record or Query subclass.
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
            restrictions - {Array} An array of objects, each containing the
                           properties:
                           * Type: The constructor for the Record or Query
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
    init: function init ( store, restrictions, frequency ) {
        this._index = 0;
        this._store = store;
        this._restrictions = restrictions;

        this.isPaused = false;
        this.frequency = frequency || 30000;

        RunLoop.invokeAfterDelay( this.cleanup, this.frequency, this );
    },

    /**
        Method: O.MemoryManager#addRestriction

        Parameters:
            restriction - {Object} An object describing the restriction for a
                          type (see constructor for format).

        Adds a restriction for a new type after initialisation.

        Returns:
            {O.MemoryManager} Returns self.
    */
    addRestriction: function addRestriction ( restriction ) {
        this._restrictions.push( restriction );
        return this;
    },

    /**
        Method: O.MemoryManager#cleanup

        Examines the store to see how many entries of each record type are
        present and removes references to the least recently accessed records
        until the number is under the set limit for that type. This is
        automatically called periodically by the memory manager.
    */
    cleanup: function cleanup () {
        var this$1 = this;

        var index = this._index;
        var restrictions = this._restrictions[ index ];
        var Type = restrictions.Type;
        var ParentType = Type;
        var max = restrictions.max;
        var afterFn = restrictions.afterCleanup;
        var deleted;

        if ( this.isPaused ) {
            RunLoop.invokeAfterDelay( this.cleanup, this.frequency, this );
            return;
        }

        do {
            if ( ParentType === Record ) {
                deleted = this$1.cleanupRecordType( Type, max );
                break;
            } else if ( ParentType === Query ) {
                deleted = this$1.cleanupQueryType( Type, max );
                break;
            }
        } while ( ParentType = ParentType.parent.constructor );

        if ( afterFn ) {
            afterFn( deleted );
        }

        this._index = index = ( index + 1 ) % this._restrictions.length;

        // Yield between examining types so we don't hog the event queue.
        if ( index ) {
            RunLoop.invokeInNextEventLoop( this.cleanup, this );
        } else {
            RunLoop.invokeAfterDelay( this.cleanup, this.frequency, this );
        }
    },

    /**
        Method: O.MemoryManager#cleanupRecordType

        Parameters:
            Type - {O.Class} The record type.
            max  - {Number} The maximum number allowed.

        Removes excess records from the store.
    */
    cleanupRecordType: function cleanupRecordType ( Type, max ) {
        var store = this._store;
        var _skToLastAccess = store._skToLastAccess;
        var _skToData = store._skToData;
        var storeKeys =
            Object.keys( store._typeToSKToId[ guid( Type ) ] || {} );
        var l = storeKeys.length;
        var numberToDelete = l - max;
        var deleted = [];

        storeKeys.sort( function ( a, b ) {
            return _skToLastAccess[b] - _skToLastAccess[a];
        });

        while ( numberToDelete > 0 && l-- ) {
            var storeKey = storeKeys[l];
            var data = _skToData[ storeKey ];
            if ( store.unloadRecord( storeKey ) ) {
                numberToDelete -= 1;
                if ( data ) {
                    deleted.push( data );
                }
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
    cleanupQueryType: function cleanupQueryType ( Type, max ) {
        var queries = this._store.getAllQueries().filter( function ( query ) {
            return query instanceof Type;
        });
        var l = queries.length;
        var numberToDelete = l - max;
        var deleted = [];

        queries.sort( function ( a, b ) {
            return b.lastAccess - a.lastAccess;
        });
        while ( numberToDelete > 0 && l-- ) {
            var query = queries[l];
            if ( !query.hasObservers() && !query.hasRangeObservers() ) {
                query.destroy();
                deleted.push( query );
                numberToDelete -= 1;
            }
        }
        return deleted;
    },
});

/*global JSON */

// eslint-disable-next-line no-duplicate-imports
/**
    Module: DataStore

    The DataStore module provides classes for managing the CRUD lifecycle of
    data records.
*/

// ---

// Error messages.
var CANNOT_CREATE_EXISTING_RECORD_ERROR =
    'O.Store Error: Cannot create existing record';
var CANNOT_WRITE_TO_UNREADY_RECORD_ERROR =
    'O.Store Error: Cannot write to unready record';
var SOURCE_COMMIT_CREATE_MISMATCH_ERROR =
    'O.Store Error: Source committed a create on a record not marked new';
var SOURCE_COMMIT_DESTROY_MISMATCH_ERROR =
    'O.Store Error: Source commited a destroy on a record not marked destroyed';

// ---

var sk = 1;
var generateStoreKey = function () {
    return 'k' + ( sk++ );
};

// ---

var mayHaveChanges = function ( store ) {
    RunLoop.queueFn( 'before', store.checkForChanges, store );
    return store;
};

// ---

var filter = function ( accept, storeKey ) {
    return accept( this._skToData[ storeKey ], this, storeKey );
};

var sort = function ( compare, a, b ) {
    var ref = this;
    var _skToData = ref._skToData;
    var aIsFirst = compare( _skToData[ a ], _skToData[ b ], this );
    return aIsFirst || ( ~~a.slice( 1 ) - ~~b.slice( 1 ) );
};

// ---

var STRING_ID = 0;
var ARRAY_IDS = 1;
var SET_IDS = 2;

var typeToForeignRefAttrs = {};

var getForeignRefAttrs = function ( Type ) {
    var typeId = guid( Type );
    var foreignRefAttrs = typeToForeignRefAttrs[ typeId ];
    var proto, attrs, attrKey, propKey, attribute;
    if ( !foreignRefAttrs ) {
        proto = Type.prototype;
        attrs = meta( proto ).attrs;
        foreignRefAttrs = [];
        for ( attrKey in attrs ) {
            propKey = attrs[ attrKey ];
            attribute = propKey && proto[ propKey ];
            if ( attribute instanceof ToOneAttribute ) {
                foreignRefAttrs.push([ attrKey, STRING_ID, attribute.Type ]);
            }
            if ( attribute instanceof ToManyAttribute ) {
                foreignRefAttrs.push([
                    attrKey,
                    attribute.Type === Object ? SET_IDS : ARRAY_IDS,
                    attribute.recordType ]);
            }
        }
        typeToForeignRefAttrs[ typeId ] = foreignRefAttrs;
    }
    return foreignRefAttrs;
};

var convertForeignKeysToSK =
        function ( store, foreignRefAttrs, data, accountId ) {
    var l = foreignRefAttrs.length;
    for ( var i = 0; i < l; i += 1 ) {
        var foreignRef = foreignRefAttrs[i];
        var attrKey = foreignRef[0];
        var AttrType = foreignRef[2];
        var idType = foreignRef[1];
        if ( attrKey in data ) {
            var value = data[ attrKey ];
            data[ attrKey ] = value && (
                idType === STRING_ID ?
                    store.getStoreKey( accountId, AttrType, value ) :
                idType === ARRAY_IDS ?
                    value.map(
                        store.getStoreKey.bind( store, accountId, AttrType )
                    ) :
                // idType === SET_IDS ?
                    Object.zip(
                        Object.keys( value ).map(
                            store.getStoreKey.bind( store, accountId, AttrType )
                        ),
                        Object.values( value )
                    )
            );
        }
    }
};

var toId = function ( store, storeKey ) {
    return store.getIdFromStoreKey( storeKey ) || '#' + storeKey;
};

var convertForeignKeysToId = function ( store, Type, data ) {
    var foreignRefAttrs = getForeignRefAttrs( Type );
    var result = data;
    var l = foreignRefAttrs.length;
    for ( var i = 0; i < l; i += 1 ) {
        var foreignRef = foreignRefAttrs[i];
        var attrKey = foreignRef[0];
        var idType = foreignRef[1];
        if ( attrKey in data ) {
            if ( result === data ) {
                result = clone( data );
            }
            var value = data[ attrKey ];
            result[ attrKey ] = value && (
                idType === STRING_ID ?
                    toId( store, value ) :
                idType === ARRAY_IDS ?
                    value.map( toId.bind( null, store ) ) :
                // idType === SET_IDS ?
                    Object.zip(
                        Object.keys( value ).map( toId.bind( null, store ) ),
                        Object.values( value )
                    )
            );
        }
    }
    return result;
};

// ---

var getChanged = function ( Type, a, b ) {
    var changed = {};
    var clientSettable = Record.getClientSettableAttributes( Type );
    var hasChanges = false;
    for ( var key in a ) {
        if ( clientSettable[ key ] && !isEqual( a[ key ], b[ key ] ) ) {
            changed[ key ] = true;
            hasChanges = true;
        }
    }
    return hasChanges ? changed : null;
};

var getDelta = function ( Type, data, changed ) {
    var proto = Type.prototype;
    var attrs = meta( proto ).attrs;
    var delta = {};
    for ( var attrKey in changed ) {
        if ( changed[ attrKey ] ) {
            var value = data[ attrKey ];
            if ( value === undefined ) {
                value = proto[ attrs[ attrKey ] ].defaultValue;
            }
            delta[ attrKey ] = value;
        }
    }
    return delta;
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
      - `OBSOLETE`: The record may have changes on the server not yet loaded.
*/
var Store = Class({

    Extends: Obj,

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
        Property: O.Store#hasChanges
        Type: Boolean

        Are there any changes in the store?
    */

    /**
        Constructor: O.Store

        Parameters:
            ...mixins - {Object} Objects to mix in, which must include a
                        parameter named `source` of type {O.Source}, the source
                        for this store.
    */
    init: function init (/* ...mixins */) {
        // Map Type -> store key -> id
        this._typeToSKToId = {};
        // Map store key -> accountId
        // We don't add store keys that belong to the default account.
        this._skToAccountId = {};
        // Map store key -> Type
        this._skToType = {};
        // Map store key -> status
        this._skToStatus = {};
        // Map store key -> data
        this._skToData = {};
        // Map store key -> object with `true` for each changed property
        this._skToChanged = {};
        // Map store key -> last committed data (when changed)
        this._skToCommitted = {};
        // Map store key -> last committed data (when committing)
        this._skToRollback = {};
        // Map store key -> record
        this._skToRecord = {};
        // Map store key -> last access timestamp for memory manager
        this._skToLastAccess = {};

        // Any changes waiting to be committed?
        this.hasChanges = false;
        // Flag if committing
        this.isCommitting = false;
        // Set of store keys for created records
        this._created = {};
        // Set of store keys for destroyed records
        this._destroyed = {};

        // Map id -> query
        this._idToQuery = {};
        // Set of types that have had data changed during this run loop
        this._changedTypes = {};

        // List of nested stores
        this._nestedStores = [];

        // Map accountId -> { status, clientState, serverState }
        // (An account MUST be added before attempting to use the store.)
        this._defaultAccountId = null;
        this._accounts = {};

        Store.parent.constructor.apply( this, arguments );

        if ( !this.get( 'isNested' ) ) {
            this.source.set( 'store', this );
        }
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
    addNested: function addNested ( store ) {
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
    removeNested: function removeNested ( store ) {
        this._nestedStores.erase( store );
        return this;
    },

    // === Accounts ============================================================

    getDefaultAccountId: function getDefaultAccountId (/* Type */) {
        return this._defaultAccountId;
    },

    getAccount: function getAccount ( accountId ) {
        if ( accountId === null || accountId === undefined ) {
            accountId = this._defaultAccountId;
        }
        return this._accounts[ accountId ];
    },

    addAccount: function addAccount ( accountId, data ) {
        var _accounts = this._accounts;
        var account = _accounts[ accountId ];
        if ( !account ) {
            account = {
                isDefault: data.isDefault,
                // Transform [ ...uri ] into { ...uri: true } for fast access
                hasDataFor: data.hasDataFor.reduce( function ( obj, uri ) {
                    obj[ uri ] = true;
                    return obj;
                }, {} ),
                // Type -> status
                // READY      - Some records of type loaded
                // LOADING    - Loading or refreshing ALL records of type
                // COMMITTING - Committing some records of type
                status: {},
                // Type -> state string for type in client
                clientState: {},
                // Type -> latest known state string for type on server
                // If committing or loading type, wait until finish to check
                serverState: {},
                // Type -> id -> store key
                typeToIdToSK: {},
                // Clients can set this to true while doing a batch of changes
                // to avoid fetching updates to related types during the process
                ignoreServerState: false,
            };
        }
        if ( data.isDefault ) {
            this._defaultAccountId = accountId;
            this._nestedStores.forEach( function (store) {
                store._defaultAccountId = accountId;
            });
            if ( accountId && _accounts[ '' ] ) {
                account.typeToIdToSK = _accounts[ '' ].typeToIdToSK;
                delete _accounts[ '' ];
            }
        }
        _accounts[ accountId ] = account;

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
            accountId - {String|null} The account to use, or null for default.
            Type      - {O.Class} The constructor for the record type.
            id        - {String} (optional) The id of the record.

        Returns:
            {String} Returns the store key for that record type and id.
    */
    getStoreKey: function getStoreKey ( accountId, Type, id ) {
        var account = this.getAccount( accountId );
        var typeId = guid( Type );
        var typeToIdToSK = account.typeToIdToSK;
        var idToSk = typeToIdToSK[ typeId ] ||
            ( typeToIdToSK[ typeId ] = {} );
        var storeKey;

        if ( id ) {
            storeKey = idToSk[ id ];
        }
        if ( !storeKey ) {
            storeKey = generateStoreKey();
            this._skToType[ storeKey ] = Type;
            if ( !account.isDefault ) {
                this._skToAccountId[ storeKey ] = accountId;
            }
            var ref = this;
            var _typeToSKToId = ref._typeToSKToId;
            var skToId = _typeToSKToId[ typeId ] ||
                ( _typeToSKToId[ typeId ] = {} );
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
            {(String|null)} Returns the id for the record, or null if the store
            key was not found or does not have an id (normally because the
            server assigns ids and the record has not yet been committed).
    */
    getIdFromStoreKey: function getIdFromStoreKey ( storeKey ) {
        var status = this._skToStatus[ storeKey ];
        var Type = this._skToType[ storeKey ];
        var skToId = this._typeToSKToId[ guid( Type ) ];
        return ( !( status & NEW ) && skToId && skToId[ storeKey ] ) || null;
    },

    /**
        Method: O.Store#getAccountIdFromStoreKey

        Get the account id for a given store key.

        Parameters:
            storeKey - {String} The store key to get the account id for.

        Returns:
            {(String)} Returns the id of the account the record belongs to.
    */
    getAccountIdFromStoreKey: function getAccountIdFromStoreKey ( storeKey ) {
        var data = this._skToData[ storeKey ];
        return data ? data.accountId :
            this._skToAccountId[ storeKey ] || this._defaultAccountId;
    },

    // === Client API ==========================================================

    /**
        Method: O.Store#getRecordStatus

        Returns the status value for a given record type and id.

        Parameters:
            accountId - {String|null} The account id.
            Type      - {O.Class} The record type.
            id        - {String} The record id.

        Returns:
            {O.Status} The status in this store of the given record.
    */
    getRecordStatus: function getRecordStatus ( accountId, Type, id ) {
        var idToSk = this.getAccount( accountId )
                           .typeToIdToSK[ guid( Type ) ];
        return idToSk ? this.getStatus( idToSk[ id ] ) : EMPTY;
    },

    /**
        Method: O.Store#getRecord

        Returns a record object for a particular type and id, creating it if it
        does not already exist and fetching its value if not already loaded in
        memory, unless the doNotFetch parameter is set.

        Parameters:
            accountId  - {String|null} The account id.
            Type       - {O.Class} The record type.
            id         - {String} The record id, or the store key prefixed with
                         a '#'.
            doNotFetch - {Boolean} (optional) If true, the record data will not
                         be fetched from the server if it is not already loaded.

        Returns:
            {O.Record|null} Returns the requested record, or null if no type or
            no id given.
    */
    getRecord: function getRecord ( accountId, Type, id, doNotFetch ) {
        var storeKey;
        if ( !Type || !id ) {
            return null;
        }
        if ( id.charAt( 0 ) === '#' ) {
            storeKey = id.slice( 1 );
            if ( this._skToType[ storeKey ] !== Type ) {
                return null;
            }
        } else {
            storeKey = this.getStoreKey( accountId, Type, id );
        }
        return this.getRecordFromStoreKey( storeKey, doNotFetch );
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
    getOne: function getOne ( Type, filter ) {
        var storeKey = this.findOne( Type, filter );
        return storeKey ? this.materialiseRecord( storeKey ) : null;
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
    getAll: function getAll ( Type, filter, sort ) {
        var storeKeys = this.findAll( Type, filter, sort );
        return new RecordArray( this, Type, storeKeys );
    },

    checkForChanges: function checkForChanges () {
        var this$1 = this;

        var storeKey;
        for ( storeKey in this$1._created ) {
            return this$1.set( 'hasChanges', true );
        }
        for ( storeKey in this$1._skToChanged ) {
            return this$1.set( 'hasChanges', true );
        }
        for ( storeKey in this$1._destroyed ) {
            return this$1.set( 'hasChanges', true );
        }
        return this.set( 'hasChanges', false );
    },

    /**
        Method: O.Store#commitChanges

        Commits any outstanding changes (created/updated/deleted records) to the
        source. Will only invoke once per run loop, even if called multiple
        times.

        Returns:
            {O.Store} Returns self.
    */
    commitChanges: function () {
        var this$1 = this;

        // Don't commit if another commit is already in progress. We can't
        // reference a foreign ID if it is currently being created in an
        // inflight request. We also need the new state string for commits
        // to a particular type to make sure we don't miss any changes.
        // We'll automatically commit again if there are any changes when the
        // current commit finishes.
        if ( this.get( 'isCommitting' ) ) {
            return;
        }
        this.set( 'isCommitting', true );

        this.fire( 'willCommit' );
        var ref = this;
        var _typeToSKToId = ref._typeToSKToId;
        var _skToData = ref._skToData;
        var _skToStatus = ref._skToStatus;
        var _skToType = ref._skToType;
        var _skToChanged = ref._skToChanged;
        var _skToCommitted = ref._skToCommitted;
        var _skToRollback = ref._skToRollback;
        var _created = ref._created;
        var _destroyed = ref._destroyed;
        var _accounts = ref._accounts;

        var changes = {};
        var hasChanges = false;

        var getEntry = function ( Type, accountId ) {
            var typeId = guid( Type );
            var entry = changes[ typeId + accountId ];
            if ( !entry ) {
                var account = _accounts[ accountId ];
                var idPropKey = Type.primaryKey || 'id';
                var idAttrKey = Type.prototype[ idPropKey ].key || idPropKey;
                entry = changes[ typeId + accountId ] = {
                    Type: Type,
                    typeId: typeId,
                    accountId: accountId,
                    primaryKey: idAttrKey,
                    create: { storeKeys: [], records: [] },
                    update: {
                        storeKeys: [],
                        records: [],
                        committed: [],
                        changes: [],
                    },
                    moveFromAccount: {},
                    destroy: { storeKeys: [], ids: [] },
                    state: account.clientState[ typeId ],
                };
                account.status[ typeId ] |= COMMITTING;
                hasChanges = true;
            }
            return entry;
        };

        for ( var storeKey in _created ) {
            var isCopyOfStoreKey = _created[ storeKey ];
            var status = _skToStatus[ storeKey ];
            var Type = _skToType[ storeKey ];
            var data = _skToData[ storeKey ];
            var accountId = data.accountId;
            var entry = getEntry( Type, accountId );
            var previousAccountId = (void 0), create = (void 0), changed = (void 0);

            if ( isCopyOfStoreKey ) {
                changed =
                    getChanged( Type, data, _skToData[ isCopyOfStoreKey ] );
                data = convertForeignKeysToId( this$1, Type, data );
                previousAccountId =
                    this$1.getAccountIdFromStoreKey( isCopyOfStoreKey );
                create = entry.moveFromAccount[ previousAccountId ] ||
                    ( entry.moveFromAccount[ previousAccountId ] = {
                        copyFromIds: [],
                        storeKeys: [],
                        records: [],
                        changes: [],
                    });
                create.copyFromIds.push(
                    this$1.getIdFromStoreKey( isCopyOfStoreKey ) );
                create.changes.push( changed );
            } else {
                data = Object.filter(
                    convertForeignKeysToId( this$1, Type, data ),
                    Record.getClientSettableAttributes( Type )
                );
                create = entry.create;
            }

            create.storeKeys.push( storeKey );
            create.records.push( data );
            this$1.setStatus( storeKey, ( status & ~DIRTY ) | COMMITTING );
        }
        for ( var storeKey$1 in _skToChanged ) {
            var status$1 = _skToStatus[ storeKey$1 ];
            var Type$1 = _skToType[ storeKey$1 ];
            var changed$1 = _skToChanged[ storeKey$1 ];
            var previous = _skToCommitted[ storeKey$1 ];
            var data$1 = _skToData[ storeKey$1 ];
            var accountId$1 = data$1.accountId;
            var update = getEntry( Type$1, accountId$1 ).update;

            _skToRollback[ storeKey$1 ] = previous;
            previous = convertForeignKeysToId( this$1, Type$1, previous );
            delete _skToCommitted[ storeKey$1 ];
            data$1 = convertForeignKeysToId( this$1, Type$1, data$1 );

            update.storeKeys.push( storeKey$1 );
            update.records.push( data$1 );
            update.committed.push( previous );
            update.changes.push( changed$1 );
            this$1.setStatus( storeKey$1, ( status$1 & ~DIRTY ) | COMMITTING );
        }
        for ( var storeKey$2 in _destroyed ) {
            var status$2 = _skToStatus[ storeKey$2 ];
            var ifCopiedStoreKey = _destroyed[ storeKey$2 ];
            // Check if already handled by moveFromAccount in create.
            if ( !ifCopiedStoreKey || !_created[ ifCopiedStoreKey ] ) {
                var Type$2 = _skToType[ storeKey$2 ];
                var accountId$2 = _skToData[ storeKey$2 ].accountId;
                var id = _typeToSKToId[ guid( Type$2 ) ][ storeKey$2 ];
                var destroy = getEntry( Type$2, accountId$2 ).destroy;

                destroy.storeKeys.push( storeKey$2 );
                destroy.ids.push( id );
            }
            this$1.setStatus( storeKey$2, ( status$2 & ~DIRTY ) | COMMITTING );
        }

        this._skToChanged = {};
        this._created = {};
        this._destroyed = {};

        if ( hasChanges ) {
            this.source.commitChanges( changes, function () {
                for ( var id in changes ) {
                    var entry = changes[ id ];
                    var Type = entry.Type;
                    var typeId = entry.typeId;
                    var accountId = entry.accountId;
                    _accounts[ accountId ].status[ typeId ] &= ~COMMITTING;
                    this$1.checkServerState( accountId, Type );
                }
                this$1.set( 'isCommitting', false );
                if ( this$1.get( 'autoCommit' ) &&
                        this$1.checkForChanges().get( 'hasChanges' ) ) {
                    this$1.commitChanges();
                }
            });
        } else {
            this.set( 'isCommitting', false );
        }

        this.set( 'hasChanges', false );
        this.fire( 'didCommit' );
    }.queue( 'middle' ),

    /**
        Method: O.Store#discardChanges

        Discards any outstanding changes (created/updated/deleted records),
        reverting the store to the last known committed state.

        Returns:
            {O.Store} Returns self.
    */
    discardChanges: function discardChanges () {
        var this$1 = this;

        var ref = this;
        var _created = ref._created;
        var _destroyed = ref._destroyed;
        var _skToChanged = ref._skToChanged;
        var _skToCommitted = ref._skToCommitted;
        var _skToType = ref._skToType;
        var _skToData = ref._skToData;

        for ( var storeKey in _created ) {
            this$1.destroyRecord( storeKey );
        }
        for ( var storeKey$1 in _skToChanged ) {
            this$1.updateData( storeKey$1, _skToCommitted[ storeKey$1 ], true );
        }
        for ( var storeKey$2 in _destroyed ) {
            this$1.undestroyRecord(
                storeKey$2, _skToType[ storeKey$2 ], _skToData[ storeKey$2 ] );
        }

        this._created = {};
        this._destroyed = {};

        return this.set( 'hasChanges', false );
    },

    getInverseChanges: function getInverseChanges () {
        var this$1 = this;

        var ref = this;
        var _created = ref._created;
        var _destroyed = ref._destroyed;
        var _skToType = ref._skToType;
        var _skToData = ref._skToData;
        var _skToChanged = ref._skToChanged;
        var _skToCommitted = ref._skToCommitted;
        var inverse = {
            create: [],
            update: [],
            destroy: [],
            move: [],
        };

        for ( var storeKey in _created ) {
            if ( !_created[ storeKey ] ) {
                inverse.destroy.push( storeKey );
            } else {
                var previousStoreKey = _created[ storeKey ];
                inverse.move.push([
                    storeKey,
                    this$1.getAccountIdFromStoreKey( previousStoreKey ),
                    previousStoreKey ]);
                inverse.update.push([
                    previousStoreKey,
                    getDelta(
                        _skToType[ storeKey ],
                        _skToData[ previousStoreKey ],
                        getChanged(
                            _skToType[ storeKey ],
                            _skToData[ previousStoreKey ],
                            _skToData[ storeKey ]
                        )
                    ) ]);
            }
        }
        for ( var storeKey$1 in _skToChanged ) {
            var committed = _skToCommitted[ storeKey$1 ];
            var changed = _skToChanged[ storeKey$1 ];
            var Type = _skToType[ storeKey$1 ];
            var update = getDelta( Type, committed, changed );
            inverse.update.push([ storeKey$1, update ]);
        }
        for ( var storeKey$2 in _destroyed ) {
            if ( !_destroyed[ storeKey$2 ] ) {
                var Type$1 = _skToType[ storeKey$2 ];
                inverse.create.push([
                    storeKey$2,
                    Type$1,
                    clone( _skToData[ storeKey$2 ] ) ]);
            }
        }

        return inverse;
    },

    applyChanges: function applyChanges ( changes ) {
        var this$1 = this;

        var create = changes.create;
        var update = changes.update;
        var destroy = changes.destroy;
        var move = changes.move;

        for ( var i = 0, l = create.length; i < l; i += 1 ) {
            var createObj = create[i];
            var storeKey = createObj[0];
            var Type = createObj[1];
            var data = createObj[2];
            this$1.undestroyRecord( storeKey, Type, data );
        }
        for ( var i$1 = 0, l$1 = move.length; i$1 < l$1; i$1 += 1 ) {
            var moveObj = move[i$1];
            var storeKey$1 = moveObj[0];
            var toAccountId = moveObj[1];
            var previousStoreKey = moveObj[2];
            this$1.moveRecord( storeKey$1, toAccountId, previousStoreKey );
        }
        for ( var i$2 = 0, l$2 = update.length; i$2 < l$2; i$2 += 1 ) {
            var updateObj = update[i$2];
            var storeKey$2 = updateObj[0];
            var data$1 = updateObj[1];
            this$1.updateData( storeKey$2, data$1, true );
        }
        for ( var i$3 = 0, l$3 = destroy.length; i$3 < l$3; i$3 += 1 ) {
            var storeKey$3 = destroy[i$3];
            this$1.destroyRecord( storeKey$3 );
        }
    },

    // === Low level (primarily internal) API: uses storeKey ===================

    /**
        Method: O.Store#getTypeStatus

        Get the status of a type

        Parameters:
            accountId - {String|null} The account id.
            Type      - {O.Class} The record type.

        Returns:
            {O.Status} The status of the type in the store.
    */
    getTypeStatus: function getTypeStatus ( accountId, Type ) {
        var this$1 = this;

        if ( !Type ) {
            var _accounts = this._accounts;
            var status = 0;
            Type = accountId;
            for ( accountId in _accounts ) {
                status |= this$1.getTypeStatus( accountId, Type );
            }
            return status;
        }
        return this.getAccount( accountId ).status[ guid( Type ) ] || EMPTY;
    },

    /**
        Method: O.Store#getTypeState

        Get the current client state token for a type.

        Parameters:
            accountId - {String|null} The account id.
            Type      - {O.Class} The record type.

        Returns:
            {String|null} The client's current state token for the type.
    */
    getTypeState: function getTypeState ( accountId, Type ) {
        return this.getAccount( accountId ).clientState[ guid( Type ) ] || null;
    },

    /**
        Method: O.Store#getStatus

        Get the status of a record with a given store key.

        Parameters:
            storeKey - {String} The store key of the record.

        Returns:
            {O.Status} The status of the record with that store key.
    */
    getStatus: function getStatus ( storeKey ) {
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
    setStatus: function setStatus ( storeKey, status ) {
        var previousStatus = this.getStatus( storeKey );
        var record = this._skToRecord[ storeKey ];
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
        Method: O.Store#getRecordFromStoreKey

        Returns a record object for a particular store key, creating it if it
        does not already exist and fetching its value if not already loaded in
        memory, unless the doNotFetch parameter is set.

        Parameters:
            storeKey   - {String} The record store key.
            doNotFetch - {Boolean} (optional) If true, the record data will not
                         be fetched from the server if it is not already loaded.

        Returns:
            {O.Record} Returns the requested record.
    */
    getRecordFromStoreKey: function getRecordFromStoreKey ( storeKey, doNotFetch ) {
        var record = this.materialiseRecord( storeKey );
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
        Method: O.Store#setRecordForStoreKey

        Sets the record instance for a store key.

        Parameters:
            storeKey - {String} The store key of the record.
            record   - {O.Record} The record.

        Returns:
            {O.Store} Returns self.
    */
    setRecordForStoreKey: function setRecordForStoreKey ( storeKey, record ) {
        this._skToRecord[ storeKey ] = record;
        return this;
    },

    /**
        Method: O.Store#materialiseRecord

        Returns the record object for a given store key, creating it if this is
        the first time it has been requested.

        Parameters:
            storeKey - {String} The store key of the record.

        Returns:
            {O.Record} Returns the requested record.
    */
    materialiseRecord: function materialiseRecord ( storeKey ) {
        return this._skToRecord[ storeKey ] ||
            ( this._skToRecord[ storeKey ] =
                new this._skToType[ storeKey ]( this, storeKey ) );
    },

    // ---

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
    mayUnloadRecord: function mayUnloadRecord ( storeKey ) {
        var record = this._skToRecord[ storeKey ];
        var status = this.getStatus( storeKey );
        // Only unload unwatched clean, non-committing records.
        if ( ( status & (COMMITTING|NEW|DIRTY) ) ||
                ( record && record.hasObservers() ) ) {
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
    willUnloadRecord: function willUnloadRecord ( storeKey ) {
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
    unloadRecord: function unloadRecord ( storeKey ) {
        if ( !this.mayUnloadRecord( storeKey ) ) {
            return false;
        }
        this.willUnloadRecord( storeKey );

        delete this._skToLastAccess[ storeKey ];
        delete this._skToRecord[ storeKey ];
        delete this._skToRollback[ storeKey ];
        delete this._skToData[ storeKey ];
        delete this._skToStatus[ storeKey ];

        // Can't delete id/sk mapping without checking if we have any other
        // references to this key elsewhere (as either a foreign key or in a
        // remote query). For now just always keep.

        return true;
    },

    // ---

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
    createRecord: function createRecord ( storeKey, data, _isCopyOfStoreKey ) {
        var status = this.getStatus( storeKey );
        if ( status !== EMPTY && status !== DESTROYED ) {
            RunLoop.didError({
                name: CANNOT_CREATE_EXISTING_RECORD_ERROR,
                message:
                    '\nStatus: ' +
                        ( Object.keyOf( Status, status ) || status ) +
                    '\nData: ' + JSON.stringify( data ),
            });
            return this;
        }

        if ( !data ) {
            data = {};
        }
        data.accountId = this.getAccountIdFromStoreKey( storeKey );

        this._created[ storeKey ] = _isCopyOfStoreKey || '';
        this._skToData[ storeKey ] = data;

        this.setStatus( storeKey, (READY|NEW|DIRTY) );

        if ( this.autoCommit ) {
            this.commitChanges();
        }

        return this.set( 'hasChanges', true );
    },

    /**
        Method: O.Store#moveRecord

        Creates a copy of a record with the given store key in a different
        account and destroys the original.

        Parameters:
            storeKey    - {String} The store key of the record to copy
            toAccountId - {String} The id of the account to copy to

        Returns:
            {String} The store key of the copy.
    */
    moveRecord: function moveRecord ( storeKey, toAccountId, copyStoreKey ) {
        var Type = this._skToType[ storeKey ];
        var copyData = clone( this._skToData[ storeKey ] );
        copyStoreKey = copyStoreKey || this._created[ storeKey ];
        if ( copyStoreKey ) {
            this.undestroyRecord( copyStoreKey, Type, copyData, storeKey );
        } else {
            copyStoreKey = this.getStoreKey( toAccountId, Type );
            this.createRecord( copyStoreKey, copyData, storeKey );
        }
        // Swizzle the storeKey on records
        this._changeRecordStoreKey( storeKey, copyStoreKey );
        // Revert data, because the change is all in the copy now.
        this.revertData( storeKey );
        this.destroyRecord( storeKey, copyStoreKey );
        return copyStoreKey;
    },

    _changeRecordStoreKey: function _changeRecordStoreKey ( oldStoreKey, newStoreKey ) {
        var ref = this;
        var _skToRecord = ref._skToRecord;
        var record = _skToRecord[ oldStoreKey ];
        if ( record ) {
            delete _skToRecord[ oldStoreKey ];
            _skToRecord[ newStoreKey ] = record;
            record
                .set( 'storeKey', newStoreKey )
                .computedPropertyDidChange( 'accountId' );
        }
        this._nestedStores.forEach( function ( store ) {
            store._changeRecordStoreKey( oldStoreKey, newStoreKey );
        });
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
    destroyRecord: function destroyRecord ( storeKey, _ifCopiedStoreKey ) {
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
            this._destroyed[ storeKey ] = _ifCopiedStoreKey || '';
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
        return mayHaveChanges( this );
    },

    undestroyRecord: function undestroyRecord ( storeKey, Type, data, _isCopyOfStoreKey ) {
        var status = this.getStatus( storeKey );
        if ( data ) {
            data = Object.filter(
                data,
                Record.getClientSettableAttributes( Type )
            );
        }
        if ( status === EMPTY || status === DESTROYED ) {
            this.createRecord( storeKey, data, _isCopyOfStoreKey );
        } else {
            if ( ( status & ~(OBSOLETE|LOADING) ) ===
                    (DESTROYED|COMMITTING) ) {
                this.setStatus( storeKey, READY|NEW|COMMITTING );
                this._created[ storeKey ] = _isCopyOfStoreKey || '';
            } else if ( status & DESTROYED ) {
                this.setStatus( storeKey,
                    ( status & ~(DESTROYED|DIRTY) ) | READY );
                delete this._destroyed[ storeKey ];
            }
            if ( data ) {
                this.updateData( storeKey, data, true );
            }
        }
        return mayHaveChanges( this );
    },

    // ---

    /**
        Method: O.Store#checkServerState

        Called internally when a type finishes loading or committing, to check
        if there's a server state update to process.

        Parameters:
            accountId - {String|null} The account id.
            Type      - {O.Class} The record type.
    */
    checkServerState: function checkServerState ( accountId, Type ) {
        var typeToServerState = this.getAccount( accountId ).serverState;
        var typeId = guid( Type );
        var serverState = typeToServerState[ typeId ];
        if ( serverState ) {
            typeToServerState[ typeId ] = '';
            this.sourceStateDidChange( accountId, Type, serverState );
        }
    },

    /**
        Method: O.Store#fetchAll

        Fetches all records of a given type from the server, or if already
        fetched updates the set of records.

        Parameters:
            accountId - {String|null} (optional) The account id. Omit to fetch
                        for all accounts.
            Type  - {O.Class} The type of records to fetch.
            force - {Boolean} (optional) Fetch even if we have a state string.

        Returns:
            {O.Store} Returns self.
    */
    fetchAll: function fetchAll ( accountId, Type, force ) {
        var this$1 = this;

        // If accountId omitted => fetch all
        if ( typeof accountId === 'function' ) {
            force = Type;
            Type = accountId;

            var _accounts = this._accounts;
            for ( accountId in _accounts ) {
                if ( accountId &&
                        _accounts[ accountId ].hasDataFor[ Type.dataGroup ] ) {
                    this$1.fetchAll( accountId, Type, force );
                }
            }
            return this;
        }

        if ( !accountId ) {
            accountId = this._defaultAccountId;
        }
        var account = this.getAccount( accountId );
        var typeId = guid( Type );
        var typeToStatus = account.status;
        var status = typeToStatus[ typeId ];
        var state = account.clientState[ typeId ];

        if ( !( status & LOADING ) && ( !( status & READY ) || force ) ) {
            this.source.fetchAllRecords( accountId, Type, state, function () {
                typeToStatus[ typeId ] &= ~LOADING;
                this$1.checkServerState( accountId, Type );
            });
            typeToStatus[ typeId ] |= LOADING;
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
    fetchData: function fetchData ( storeKey ) {
        var status = this.getStatus( storeKey );
        // Nothing to do if already loading or new, destroyed or non-existent.
        if ( status & (LOADING|NEW|DESTROYED|NON_EXISTENT) ) {
            return this;
        }
        var Type = this._skToType[ storeKey ];
        if ( !Type ) {
            return this;
        }
        var id = this._typeToSKToId[ guid( Type ) ][ storeKey ];
        var accountId = this.getAccountIdFromStoreKey( storeKey );

        if ( status & EMPTY ) {
            this.source.fetchRecord( accountId, Type, id );
            this.setStatus( storeKey, (EMPTY|LOADING) );
        } else {
            this.source.refreshRecord( accountId, Type, id );
            this.setStatus( storeKey, status | LOADING );
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
    getData: function getData ( storeKey ) {
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
    setData: function setData ( storeKey, data ) {
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
    updateData: function updateData ( storeKey, data, changeIsDirty ) {
        var status = this.getStatus( storeKey );
        var ref = this;
        var _skToData = ref._skToData;
        var _skToCommitted = ref._skToCommitted;
        var _skToChanged = ref._skToChanged;
        var isNested = ref.isNested;
        var current = _skToData[ storeKey ];
        var changedKeys = [];
        var seenChange = false;

        if ( !current || ( changeIsDirty && !( status & READY ) ) ) {
            RunLoop.didError({
                name: CANNOT_WRITE_TO_UNREADY_RECORD_ERROR,
                message:
                    '\nStatus: ' +
                        ( Object.keyOf( Status, status ) || status ) +
                    '\nData: ' + JSON.stringify( data ),
            });
            return false;
        }

        // Copy-on-write for nested stores.
        if ( isNested && !_skToData.hasOwnProperty( storeKey ) ) {
            _skToData[ storeKey ] = current = clone( current );
        }

        if ( changeIsDirty && status !== (READY|NEW|DIRTY) ) {
            var committed = _skToCommitted[ storeKey ] ||
                ( _skToCommitted[ storeKey ] = clone( current ) );
            var changed = _skToChanged[ storeKey ] ||
                ( _skToChanged[ storeKey ] = {} );

            for ( var key in data ) {
                var value = data[ key ];
                var oldValue = current[ key ];
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
                for ( var key$1 in changed ) {
                    if ( changed[ key$1 ] ) {
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
                if ( isNested ) {
                    delete _skToData[ storeKey ];
                }
            }
            mayHaveChanges( this );
        } else {
            for ( var key$2 in data ) {
                var value$1 = data[ key$2 ];
                var oldValue$1 = current[ key$2 ];
                if ( !isEqual( value$1, oldValue$1 ) ) {
                    current[ key$2 ] = value$1;
                    changedKeys.push( key$2 );
                }
            }
        }

        // If the record is new (so not in other stores), update the accountId
        // associated with the record.
        var accountId = data.accountId;
        if ( status === (READY|NEW|DIRTY) && accountId ) {
            var oldAccount = this.getAccount(
                this._skToAccountId[ storeKey ] || this._defaultAccountId
            );
            var newAccount = this.getAccount( accountId );
            if ( !oldAccount.isDefault ) {
                delete this._skToAccountId[ storeKey ];
            }
            if ( !newAccount.isDefault ) {
                this._skToAccountId[ storeKey ] = accountId;
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
    revertData: function revertData ( storeKey ) {
        var Type = this._skToType[ storeKey ];
        var committed = this._skToCommitted[ storeKey ];
        var changed = this._skToChanged[ storeKey ];

        if ( committed ) {
            var proto = Type.prototype;
            var attrs = meta( proto ).attrs;
            var defaultValue;
            for ( var attrKey in changed ) {
                if ( committed[ attrKey ] === undefined ) {
                    defaultValue = proto[ attrs[ attrKey ] ].defaultValue;
                    if ( defaultValue === undefined ) {
                        defaultValue = null;
                    }
                    committed[ attrKey ] = defaultValue;
                }
            }
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
    _notifyRecordOfChanges: function _notifyRecordOfChanges ( storeKey, changedKeys ) {
        var record = this._skToRecord[ storeKey ];
        if ( record ) {
            var errorForAttribute;
            var attrs = meta( record ).attrs;
            record.beginPropertyChanges();
            var l = changedKeys.length;
            while ( l-- ) {
                var attrKey = changedKeys[l];
                var propKey = attrs[ attrKey ];
                // Server may return more data than is defined in the record;
                // ignore the rest.
                if ( !propKey ) {
                    // Special case: implicit id/accountId attributes
                    if ( attrKey === 'id' || attrKey === 'accountId' ) {
                        propKey = attrKey;
                    } else {
                        continue;
                    }
                }
                var attribute = record[ propKey ];
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

    /**
        Method: O.Store#_recordDidChange

        Called when the status and/or data for a record changes.

        Parameters:
            storeKey - {String} The store key of the record.
    */
    _recordDidChange: function _recordDidChange ( storeKey ) {
        var typeId = guid( this._skToType[ storeKey ] );
        this._changedTypes[ typeId ] = true;
        RunLoop.queueFn( 'middle', this._fireTypeChanges, this );
    },

    /**
        Method: O.Store#_fireTypeChanges
    */
    _fireTypeChanges: function _fireTypeChanges () {
        var this$1 = this;

        var ref = this;
        var _changedTypes = ref._changedTypes;
        this._changedTypes = {};

        for ( var typeId in _changedTypes ) {
            this$1.fire( typeId );
        }

        return this;
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
    findAll: function findAll ( Type, accept, compare ) {
        var skToId = this._typeToSKToId[ guid( Type ) ] || {};
        var ref = this;
        var _skToStatus = ref._skToStatus;
        var results = [];

        for ( var storeKey in skToId ) {
            if ( _skToStatus[ storeKey ] & READY ) {
                results.push( storeKey );
            }
        }

        if ( accept ) {
            var filterFn = filter.bind( this, accept );
            results = results.filter( filterFn );
            results.filterFn = filterFn;
        }

        if ( compare ) {
            var sortFn = sort.bind( this, compare );
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
    findOne: function findOne ( Type, accept ) {
        var _skToId = this._typeToSKToId[ guid( Type ) ] || {};
        var ref = this;
        var _skToStatus = ref._skToStatus;
        var filterFn = accept && filter.bind( this, accept );

        for ( var storeKey in _skToId ) {
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
            query - {O.Query} The query object.

        Returns:
            {O.Store} Returns self.
    */
    addQuery: function addQuery ( query ) {
        this._idToQuery[ query.get( 'id' ) ] = query;
        return this;
    },

    /**
        Method: O.Store#removeQuery

        Deregisters a query with the store. This is automatically called when
        you call destroy() on a query. You should never need to call this
        manually.

        Parameters:
            query - {O.Query} The query object.

        Returns:
            {O.Store} Returns self.
    */
    removeQuery: function removeQuery ( query ) {
        delete this._idToQuery[ query.get( 'id' ) ];
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
            mixin      - {(Object|null)} (optional) Properties to pass to the
                         QueryClass constructor.

        Returns:
            {(O.Query|null)} The requested query.
    */
    getQuery: function getQuery ( id, QueryClass, mixin$$1 ) {
        var query = ( id && this._idToQuery[ id ] ) || null;
        if ( !query && QueryClass ) {
            query = new QueryClass( Object.assign( mixin$$1 || {}, {
                id: id,
                store: this,
                source: this.get( 'source' ),
            }));
        }
        if ( query ) {
            query.lastAccess = Date.now();
        }
        return query;
    },

    /**
        Method: O.Store#getAllQueries

        Returns a list of all remote queries registered with the store.

        Returns:
            {O.Query[]} A list of all registered queries.
    */
    getAllQueries: function getAllQueries () {
        return Object.values( this._idToQuery );
    },

    // === Source callbacks ====================================================

    /**
        Method: O.Store#sourceStateDidChange

        Call this method to notify the store of a change in the state of a
        particular record type in the source. The store will wait for any
        loading or committing of this type to finish, then check its state. If
        it doesn't match, it will then request updates.

        Parameters:
            accountId - {String|null} The account id.
            Type      - {O.Class} The record type.
            newState  - {String} The new state on the server.

        Returns:
            {O.Store} Returns self.
    */
    sourceStateDidChange: function sourceStateDidChange ( accountId, Type, newState ) {
        var account = this.getAccount( accountId );
        var typeId = guid( Type );
        var clientState = account.clientState[ typeId ];

        if ( account.serverState[ typeId ] === newState ) {
            // Do nothing, we're already in this state.
        } else if ( clientState && newState !== clientState &&
                !account.ignoreServerState &&
                !( account.status[ typeId ] & (LOADING|COMMITTING) ) ) {
            // Set this to clientState to avoid potential infinite loop. We
            // don't know for sure if our serverState is older or newer due to
            // concurrency. As we're now requesting updates, we can reset it to
            // be clientState and then it will be updated to the real new server
            // automatically if has changed in the sourceDidFetchUpdates
            // handler. If a push comes in while fetching the updates, this
            // won't match and we'll fetch again.
            account.serverState[ typeId ] = clientState;
            this.fire( typeId + ':server:' + accountId );
            this.fetchAll( accountId, Type, true );
        } else {
            account.serverState[ typeId ] = newState;
            if ( !clientState ) {
                // We have a query but not matches yet; we still need to
                // refresh the queries in case there are now matches.
                this.fire( typeId + ':server:' + accountId );
            }
        }

        return this;
    },

    // ---

    /**
        Method: O.Store#sourceDidFetchRecords

        Callback made by the <O.Source> object associated with this store when
        it fetches some records from the server.

        Parameters:
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            records   - {Object[]} Array of data objects.
            state     - {String} (optional) The state of the record type on the
                        server.
            isAll     - {Boolean} This is all the records of this type on the
                        server.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidFetchRecords: function sourceDidFetchRecords ( accountId, Type, records, state, isAll ) {
        var this$1 = this;

        var ref = this;
        var _skToData = ref._skToData;
        var _skToLastAccess = ref._skToLastAccess;
        var account = this.getAccount( accountId );
        var typeId = guid( Type );
        var idPropKey = Type.primaryKey || 'id';
        var idAttrKey = Type.prototype[ idPropKey ].key || idPropKey;
        var now = Date.now();
        var seen = {};
        var updates = {};
        var foreignRefAttrs = getForeignRefAttrs( Type );
        var l = records.length;

        if ( !accountId ) {
            accountId = this._defaultAccountId;
        }

        while ( l-- ) {
            var data = records[l];
            var id = data[ idAttrKey ];
            var storeKey = this$1.getStoreKey( accountId, Type, id );
            var status = this$1.getStatus( storeKey );
            seen[ storeKey ] = true;

            if ( foreignRefAttrs.length ) {
                convertForeignKeysToSK(
                    this$1, foreignRefAttrs, data, accountId );
            }
            data.accountId = accountId;

            if ( status & READY ) {
                // We already have the record loaded, process it as an update.
                updates[ id ] = data;
            } else if ( ( status & DESTROYED ) &&
                    ( status & (DIRTY|COMMITTING) ) ) {
                // We're in the middle of destroying it. Update the data in case
                // we need to roll back.
                _skToData[ storeKey ] = data;
                this$1.setStatus( storeKey, status & ~LOADING );
            } else {
                // Anything else is new.
                if ( !( status & EMPTY ) ) {
                    // Record was destroyed or non-existent, but has now been
                    // created (again). Set status back to empty so setData
                    // works.
                    this$1.setStatus( storeKey, EMPTY );
                }
                this$1.setData( storeKey, data );
                this$1.setStatus( storeKey, READY );
                _skToLastAccess[ storeKey ] = now;
            }
        }

        if ( isAll ) {
            var skToId = this._typeToSKToId[ guid( Type ) ];
            var destroyed = [];
            for ( var storeKey$1 in skToId ) {
                if ( seen[ storeKey$1 ] ) {
                    continue;
                }
                var status$1 = this$1.getStatus( storeKey$1 );
                if ( ( status$1 & READY ) && !( status$1 & NEW ) &&
                        _skToData[ storeKey$1 ].accountId === accountId ) {
                    destroyed.push( skToId[ storeKey$1 ] );
                }
            }
            if ( destroyed.length ) {
                this.sourceDidDestroyRecords( accountId, Type, destroyed );
            }
        }

        this.sourceDidFetchPartialRecords( accountId, Type, updates, true );

        if ( state ) {
            var oldClientState = account.clientState[ typeId ];
            var oldServerState = account.serverState[ typeId ];
            // If the state has changed, we need to fetch updates, but we can
            // still load these records
            if ( !isAll && oldClientState && oldClientState !== state ) {
                this.sourceStateDidChange( accountId, Type, state );
            } else {
                account.clientState[ typeId ] = state;
                if ( !oldClientState || !oldServerState ) {
                    account.serverState[ typeId ] = state;
                }
            }
        }
        account.status[ typeId ] |= READY;

        // Notify LocalQuery we're now ready even if no records loaded.
        this._changedTypes[ typeId ] = true;
        RunLoop.queueFn( 'middle', this._fireTypeChanges, this );

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
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            updates   - {Object} An object mapping record id to an object of
                        changed attributes.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidFetchPartialRecords: function sourceDidFetchPartialRecords ( accountId, Type, updates, _idsAreSKs ) {
        var this$1 = this;

        var account = this.getAccount( accountId );
        var typeId = guid( Type );
        var ref = this;
        var _skToData = ref._skToData;
        var _skToStatus = ref._skToStatus;
        var _skToChanged = ref._skToChanged;
        var _skToCommitted = ref._skToCommitted;
        var _idToSk = account.typeToIdToSK[ typeId ] || {};
        var _skToId = this._typeToSKToId[ typeId ] || {};
        var idPropKey = Type.primaryKey || 'id';
        var idAttrKey = Type.prototype[ idPropKey ].key || idPropKey;
        var foreignRefAttrs = _idsAreSKs ? [] : getForeignRefAttrs( Type );

        for ( var id in updates ) {
            var storeKey = _idToSk[ id ];
            var status = _skToStatus[ storeKey ];
            var update = updates[ id ];

            // Skip if no update to process
            // Also can't update an empty or destroyed record.
            if ( !update || !( status & READY ) ) {
                continue;
            }

            // If the record is committing, we don't know for sure what state
            // the update was applied on top of, so fetch again to be sure.
            if ( status & COMMITTING ) {
                this$1.setStatus( storeKey, status & ~LOADING );
                this$1.fetchData( storeKey );
                continue;
            }

            if ( foreignRefAttrs.length ) {
                convertForeignKeysToSK(
                    this$1, foreignRefAttrs, update, accountId );
            }

            if ( status & DIRTY ) {
                // If we have a conflict we can either rebase on top, or discard
                // our local changes.
                update = Object.assign( _skToCommitted[ storeKey ], update );
                if ( this$1.rebaseConflicts ) {
                    var oldData = _skToData[ storeKey ];
                    var oldChanged = _skToChanged[ storeKey ];
                    var newData = {};
                    var newChanged = {};
                    var clean = true;
                    // Every key in here must be reapplied on top, even if
                    // changed[key] === false, as this means it's been
                    // changed then changed back.
                    for ( var key in oldData ) {
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
                        this$1.setData( storeKey, newData );
                        this$1.setStatus( storeKey, (READY|DIRTY) );
                        continue;
                    }
                }
                delete _skToChanged[ storeKey ];
                delete _skToCommitted[ storeKey ];
            }

            var newId = update[ idAttrKey ];
            if ( newId && newId !== id ) {
                // Don't delete the old idToSk mapping, as references to the
                // old id may still appear in queryChanges responses
                _skToId[ storeKey ] = newId;
                _idToSk[ newId ] = storeKey;
            }

            this$1.updateData( storeKey, update, false );
            this$1.setStatus( storeKey, READY );
        }
        return mayHaveChanges( this );
    },

    /**
        Method: O.Store#sourceCouldNotFindRecords

        Callback made by the <O.Source> object associated with this store when
        it has been asked to fetch certain record ids and the server has
        responded that the records do not exist.

        Parameters:
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            ids       - {String[]} The list of ids of non-existent requested
                        records.

        Returns:
            {O.Store} Returns self.
    */
    sourceCouldNotFindRecords: function sourceCouldNotFindRecords ( accountId, Type, ids ) {
        var this$1 = this;

        var l = ids.length;
        var ref = this;
        var _skToCommitted = ref._skToCommitted;
        var _skToChanged = ref._skToChanged;

        while ( l-- ) {
            var storeKey = this$1.getStoreKey( accountId, Type, ids[l] );
            var status = this$1.getStatus( storeKey );
            if ( status & EMPTY ) {
                this$1.setStatus( storeKey, NON_EXISTENT );
            } else {
                if ( status & DIRTY ) {
                    this$1.setData( storeKey, _skToCommitted[ storeKey ] );
                    delete _skToCommitted[ storeKey ];
                    delete _skToChanged[ storeKey ];
                }
                this$1.setStatus( storeKey, DESTROYED );
                this$1.unloadRecord( storeKey );
            }
        }
        return mayHaveChanges( this );
    },

    // ---

    /**
        Method: O.Store#sourceDidFetchUpdates

        Callback made by the <O.Source> object associated with this store when
        it fetches the ids of all records of a particular type that have been
        created/modified/destroyed of a particular since the client's state.

        Parameters:
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            changed   - {String[]} List of ids for records which have been
                        added or changed in the store since oldState.
            destroyed - {String[]} List of ids for records which have been
                        destroyed in the store since oldState.
            oldState  - {String} The state these changes are from.
            newState  - {String} The state these changes are to.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidFetchUpdates: function sourceDidFetchUpdates ( accountId, Type, changed, destroyed, oldState,
            newState ) {
        var account = this.getAccount( accountId );
        var typeId = guid( Type );
        if ( oldState === account.clientState[ typeId ] ) {
            // Invalidate changed records
            if ( changed && changed.length ) {
                this.sourceDidModifyRecords( accountId, Type, changed );
            }
            if ( destroyed && destroyed.length ) {
                this.sourceDidDestroyRecords( accountId, Type, destroyed );
            }
            // Invalidate remote queries on the type, unless this was done
            // before.
            if ( oldState !== newState &&
                    newState !== account.serverState[ typeId ] ) {
                this.fire( typeId + ':server:' + accountId );
            }
            account.clientState[ typeId ] = newState;
            if ( account.serverState[ typeId ] === oldState ) {
                account.serverState[ typeId ] = newState;
            }
        } else {
            this.sourceStateDidChange( accountId, Type, newState );
        }
        return this;
    },

    /**
        Method: O.Store#sourceDidModifyRecords

        Callback made by the <O.Source> object associated with this store when
        some records may be out of date.

        Parameters:
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            ids       - {String[]} The list of ids of records which have
                        updates available on the server.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidModifyRecords: function sourceDidModifyRecords ( accountId, Type, ids ) {
        var this$1 = this;

        var l = ids.length;
        while ( l-- ) {
            var storeKey = this$1.getStoreKey( accountId, Type, ids[l] );
            var status = this$1.getStatus( storeKey );
            if ( status & READY ) {
                this$1.setStatus( storeKey, status | OBSOLETE );
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
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            ids       - {String[]} The list of ids of records which have been
                        destroyed.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidDestroyRecords: function sourceDidDestroyRecords ( accountId, Type, ids ) {
        var this$1 = this;

        var l = ids.length;
        while ( l-- ) {
            var storeKey = this$1.getStoreKey( accountId, Type, ids[l] );
            this$1.setStatus( storeKey, DESTROYED );
            this$1.unloadRecord( storeKey );
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
            accountId - {String} The account id.
            Type      - {O.Class} The record type.
            oldState  - {String} The state before the commit.
            newState  - {String} The state after the commit.

        Returns:
            {O.Store} Returns self.
    */
    sourceCommitDidChangeState: function sourceCommitDidChangeState ( accountId, Type, oldState, newState ) {
        var account = this.getAccount( accountId );
        var typeId = guid( Type );

        if ( account.clientState[ typeId ] === oldState ) {
            account.clientState[ typeId ] = newState;
            if ( account.serverState[ typeId ] === oldState ) {
                account.serverState[ typeId ] = newState;
            }
        } else {
            this.sourceStateDidChange( accountId, Type, newState );
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
            skToPartialData - {Object} A map of the store key to an object
            with properties for the newly created record, which MUST include
            the id.

        Returns:
            {O.Store} Returns self.
    */
    sourceDidCommitCreate: function sourceDidCommitCreate ( skToPartialData ) {
        var this$1 = this;

        var ref = this;
        var _skToType = ref._skToType;
        var _skToData = ref._skToData;
        var _typeToSKToId = ref._typeToSKToId;
        for ( var storeKey in skToPartialData ) {
            var status = this$1.getStatus( storeKey );
            if ( status & NEW ) {
                var data = skToPartialData[ storeKey ];

                var Type = _skToType[ storeKey ];
                var typeId = guid( Type );
                var idPropKey = Type.primaryKey || 'id';
                var idAttrKey = Type.prototype[ idPropKey ].key || idPropKey;
                var accountId = _skToData[ storeKey ].accountId;
                var id = data[ idAttrKey ];
                var typeToIdToSK = this$1.getAccount( accountId ).typeToIdToSK;
                var skToId = _typeToSKToId[ typeId ] ||
                    ( _typeToSKToId[ typeId ] = {} );
                var idToSK = typeToIdToSK[ typeId ] ||
                    ( typeToIdToSK[ typeId ] = {} );

                // Set id internally
                skToId[ storeKey ] = id;
                idToSK[ id ] = storeKey;

                var foreignRefAttrs = getForeignRefAttrs( Type );
                if ( foreignRefAttrs.length ) {
                    convertForeignKeysToSK(
                        this$1, foreignRefAttrs, data, accountId );
                }

                // Notify record, and update with any other data
                this$1.updateData( storeKey, data, false );
                this$1.setStatus( storeKey, status & ~(COMMITTING|NEW) );
            } else {
                RunLoop.didError({
                    name: SOURCE_COMMIT_CREATE_MISMATCH_ERROR,
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
        <O.Event#preventDefault> is called on the event object, the record
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
    sourceDidNotCreate: function sourceDidNotCreate ( storeKeys, isPermanent, errors ) {
        var this$1 = this;

        var l = storeKeys.length;
        var ref = this;
        var _skToCommitted = ref._skToCommitted;
        var _skToChanged = ref._skToChanged;
        var _created = ref._created;

        while ( l-- ) {
            var storeKey = storeKeys[l];
            var status = this$1.getStatus( storeKey );
            if ( status & DESTROYED ) {
                this$1.setStatus( storeKey, DESTROYED );
                this$1.unloadRecord( storeKey );
            } else {
                if ( status & DIRTY ) {
                    delete _skToCommitted[ storeKey ];
                    delete _skToChanged[ storeKey ];
                }
                this$1.setStatus( storeKey, (READY|NEW|DIRTY) );
                _created[ storeKey ] = '';
                if ( isPermanent && ( !errors ||
                        !this$1._notifyRecordOfError( storeKey, errors[l] ) ) ) {
                    this$1.destroyRecord( storeKey );
                }
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return mayHaveChanges( this );
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
    sourceDidCommitUpdate: function sourceDidCommitUpdate ( storeKeys ) {
        var this$1 = this;

        var l = storeKeys.length;
        var ref = this;
        var _skToRollback = ref._skToRollback;

        while ( l-- ) {
            var storeKey = storeKeys[l];
            var status = this$1.getStatus( storeKey );
            delete _skToRollback[ storeKey ];
            if ( status !== EMPTY ) {
                this$1.setStatus( storeKey, status & ~COMMITTING );
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
        if already instantiated. If <O.Event#preventDefault> is called on the
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
    sourceDidNotUpdate: function sourceDidNotUpdate ( storeKeys, isPermanent, errors ) {
        var this$1 = this;

        var l = storeKeys.length;
        var ref = this;
        var _skToData = ref._skToData;
        var _skToChanged = ref._skToChanged;
        var _skToCommitted = ref._skToCommitted;
        var _skToRollback = ref._skToRollback;
        var _skToType = ref._skToType;

        while ( l-- ) {
            var storeKey = storeKeys[l];
            var status = this$1.getStatus( storeKey );
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
                    this$1.setStatus( storeKey, status & ~COMMITTING );
                }
                continue;
            }
            var committed = _skToCommitted[ storeKey ] =
                _skToRollback[ storeKey ];
            delete _skToRollback[ storeKey ];
            var current = _skToData[ storeKey ];
            delete _skToChanged[ storeKey ];
            var changed =
                getChanged( _skToType[ storeKey ], current, committed );
            if ( changed ) {
                _skToChanged[ storeKey ] = changed;
                this$1.setStatus( storeKey, ( status & ~COMMITTING )|DIRTY );
            } else {
                this$1.setStatus( storeKey, ( status & ~COMMITTING ) );
            }
            if ( isPermanent && ( !errors ||
                    !this$1._notifyRecordOfError( storeKey, errors[l] ) ) ) {
                this$1.revertData( storeKey );
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return mayHaveChanges( this );
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
    sourceDidCommitDestroy: function sourceDidCommitDestroy ( storeKeys ) {
        var this$1 = this;

        var l = storeKeys.length;
        var storeKey, status;
        while ( l-- ) {
            storeKey = storeKeys[l];
            status = this$1.getStatus( storeKey );

            // If the record has been undestroyed while being committed
            // it will no longer be in the destroyed state, but instead be
            // READY|NEW|COMMITTING.
            if ( ( status & ~DIRTY ) === (READY|NEW|COMMITTING) ) {
                if ( status & DIRTY ) {
                    delete this$1._skToCommitted[ storeKey ];
                    delete this$1._skToChanged[ storeKey ];
                }
                this$1.setStatus( storeKey, (READY|NEW|DIRTY) );
            } else if ( status & DESTROYED ) {
                this$1.setStatus( storeKey, DESTROYED );
                this$1.unloadRecord( storeKey );
            } else {
                RunLoop.didError({
                    name: SOURCE_COMMIT_DESTROY_MISMATCH_ERROR,
                });
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return mayHaveChanges( this );
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
        <O.Event#preventDefault> is called on the event object, the record will
        **not** be revived; it is up to the handler to then fix the record
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
    sourceDidNotDestroy: function sourceDidNotDestroy ( storeKeys, isPermanent, errors ) {
        var this$1 = this;

        var l = storeKeys.length;
        var ref = this;
        var _created = ref._created;
        var _destroyed = ref._destroyed;

        while ( l-- ) {
            var storeKey = storeKeys[l];
            var status = this$1.getStatus( storeKey );
            if ( ( status & ~DIRTY ) === (READY|NEW|COMMITTING) ) {
                this$1.setStatus( storeKey, status & ~(COMMITTING|NEW) );
                delete _created[ storeKey ];
            } else if ( status & DESTROYED ) {
                this$1.setStatus( storeKey, ( status & ~COMMITTING )|DIRTY );
                _destroyed[ storeKey ] = '';
                if ( isPermanent && ( !errors ||
                        !this$1._notifyRecordOfError( storeKey, errors[l] ) ) ) {
                    this$1.undestroyRecord( storeKey );
                }
            } else {
                RunLoop.didError({
                    name: SOURCE_COMMIT_DESTROY_MISMATCH_ERROR,
                });
            }
        }
        if ( this.autoCommit ) {
            this.commitChanges();
        }
        return mayHaveChanges( this );
    },

    _notifyRecordOfError: function _notifyRecordOfError ( storeKey, error ) {
        var record = this._skToRecord[ storeKey ];
        var isDefaultPrevented = false;
        if ( record ) {
            var event = new Event( error.type || 'error', record, error );
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
});

[ 'on', 'once', 'off' ].forEach( function ( property ) {
    Store.prototype[ property ] = function ( type, obj, method ) {
        if ( typeof type !== 'string' ) {
            type = guid( type );
        }
        return EventTarget[ property ].call( this, type, obj, method );
    };
});

/**
    Class: O.NestedStore

    A Nested Store may be used to buffer changes before committing them to the
    parent store. The changes may be discarded instead of committing without
    ever affecting the parent store.
*/
var NestedStore = Class({

    Extends: Store,

    autoCommit: false,
    isNested: true,

    /**
        Constructor: O.NestedStore

        Parameters:
            store - {O.Store} The parent store (this may be another nested
                    store).
    */
    init: function init ( store ) {
        NestedStore.parent.constructor.call( this );

        // Shared properties with parent
        this._typeToSKToId = store._typeToSKToId;
        this._skToAccountId = store._skToAccountId;
        this._skToType = store._skToType;
        this._skToLastAccess = store._skToLastAccess;
        this._accounts = store._accounts;
        this._defaultAccountId = store._defaultAccountId;

        // Copy on write, shared status/data
        this._skToStatus = Object.create( store._skToStatus );
        this._skToData = Object.create( store._skToData );

        store.addNested( this );

        this._parentStore = store;
    },

    /**
        Method: O.NestedStore#destroy

        Removes the connection to the parent store so this store may be garbage
        collected.
    */
    destroy: function destroy () {
        this._parentStore.removeNested( this );
    },

    // === Client API ==========================================================

    /**
        Method: O.Store#commitChanges

        Commits any outstanding changes (created/updated/deleted records) to the
        parent store.

        Returns:
            {O.NestedStore} Returns self.
    */
    commitChanges: function commitChanges () {
        var this$1 = this;

        this.fire( 'willCommit' );
        var ref = this;
        var _created = ref._created;
        var _destroyed = ref._destroyed;
        var _skToData = ref._skToData;
        var _skToChanged = ref._skToChanged;
        var parent = this._parentStore;

        for ( var storeKey in _created ) {
            var isCopyOfStoreKey = _created[ storeKey ];
            if ( isCopyOfStoreKey ) {
                var data = _skToData[ storeKey ];
                parent.moveRecord( isCopyOfStoreKey,
                    this$1.getAccountIdFromStoreKey( storeKey ), storeKey );
                delete _skToData[ storeKey ];
                parent.updateData( storeKey, data, true );
            } else {
                var status = parent.getStatus( storeKey );
                var data$1 = _skToData[ storeKey ];
                if ( status === EMPTY || status === DESTROYED ) {
                    parent.createRecord( storeKey, data$1 );
                } else if ( ( status & ~(OBSOLETE|LOADING) ) ===
                        (DESTROYED|COMMITTING) ) {
                    parent._skToData[ storeKey ] = data$1;
                    parent.setStatus( storeKey, READY|NEW|COMMITTING );
                } else if ( status & DESTROYED ) {
                    delete parent._destroyed[ storeKey ];
                    parent._skToData[ storeKey ] = data$1;
                    parent.setStatus( storeKey,
                        ( status & ~(DESTROYED|DIRTY) ) | READY );
                }
            }
        }
        for ( var storeKey$1 in _skToChanged ) {
            var changed = _skToChanged[ storeKey$1 ];
            var data$2 = _skToData[ storeKey$1 ];
            parent.updateData( storeKey$1, Object.filter( data$2, changed ), true );
        }
        for ( var storeKey$2 in _destroyed ) {
            var ifCopiedStoreKey = _destroyed[ storeKey$2 ];
            // Check if already handled by moveFromAccount in create.
            if ( !ifCopiedStoreKey || !_created[ ifCopiedStoreKey ] ) {
                parent.destroyRecord( storeKey$2 );
            }
        }

        this._skToData = Object.create( parent._skToData );
        this._skToStatus = Object.create( parent._skToStatus );
        this._skToChanged = {};
        this._skToCommitted = {};
        this._created = {};
        this._destroyed = {};

        return this.set( 'hasChanges', false ).fire( 'didCommit' );
    },

    /**
        Method: O.Store#discardChanges

        Discards any outstanding changes (created/updated/deleted records),
        reverting the store to the same state as its parent.

        Returns:
            {O.NestedStore} Returns self.
    */
    discardChanges: function discardChanges () {
        NestedStore.parent.discardChanges.call( this );

        var parent = this._parentStore;

        this._skToData = Object.create( parent._skToData );
        this._skToStatus = Object.create( parent._skToStatus );

        return this;
    },

    // === Low level (primarily internal) API: uses storeKey ===================

    getStatus: function getStatus ( storeKey ) {
        var status = this._skToStatus[ storeKey ] || EMPTY;
        return this._skToData.hasOwnProperty( storeKey ) ?
            status : status & ~(NEW|COMMITTING|DIRTY);
    },

    fetchAll: function fetchAll ( accountId, Type, force ) {
        this._parentStore.fetchAll( accountId, Type, force );
        return this;
    },

    fetchData: function fetchData ( storeKey ) {
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
    parentDidChangeStatus: function parentDidChangeStatus ( storeKey, previous, status ) {
        var ref = this;
        var _skToStatus = ref._skToStatus;

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
            } else if ( !( previous & NEW ) ) {
                // If NEW, parent status means it's been committed, which means
                // we're going to clear _skToStatus so we're already correct
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
    parentDidSetData: function parentDidSetData ( storeKey, changedKeys ) {
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
    parentDidUpdateData: function parentDidUpdateData ( storeKey, changedKeys ) {
        var ref = this;
        var _skToData = ref._skToData;
        var _skToChanged = ref._skToChanged;
        var _skToCommitted = ref._skToCommitted;
        var oldChanged = _skToChanged[ storeKey ];
        if ( oldChanged && _skToData.hasOwnProperty( storeKey ) ) {
            var parent = this._parentStore;
            var rebase = this.rebaseConflicts;
            var newBase = parent.getData( storeKey );
            var oldData = _skToData[ storeKey ];
            var newData = {};
            var newChanged = {};
            var clean = true;
            var isChanged, key;

            changedKeys = [];

            for ( key in oldData ) {
                isChanged = !isEqual( oldData[ key ], newBase[ key ] );
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
                _skToCommitted[ storeKey ] = clone( newBase );
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
        RunLoop.queueFn( 'before', this.checkForChanges, this );
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
    sourceDidNotDestroy: null,
});

/**
    Class: O.UndoManager
*/

var UndoManager = Class({

    Extends: Obj,

    init: function init (/* ...mixins */) {
        this._undoStack = [];
        this._redoStack = [];

        this._isInUndoState = false;

        this.canUndo = false;
        this.canRedo = false;

        this.maxUndoCount = 1;

        UndoManager.parent.constructor.apply( this, arguments );
    },

    _pushState: function _pushState ( stack, data ) {
        stack.push( data );
        while ( stack.length > this.maxUndoCount ) {
            stack.shift();
        }
        this._isInUndoState = true;
    },

    dataDidChange: function dataDidChange () {
        this._isInUndoState = false;
        return this
            .set( 'canRedo', false )
            .set( 'canUndo', true )
            .fire( 'input' );
    },

    saveUndoCheckpoint: function saveUndoCheckpoint () {
        if ( !this._isInUndoState ) {
            var data = this.getUndoData();
            if ( data !== null ) {
                this._pushState( this._undoStack, data );
            }
            this._isInUndoState = true;
            this._redoStack.length = 0;
            this.set( 'canUndo', !!this._undoStack.length )
                .set( 'canRedo', false );
        }
        return this;
    },

    undo: function undo () {
        if ( this.get( 'canUndo' ) ) {
            if ( !this._isInUndoState ) {
                this.saveUndoCheckpoint();
                this.undo();
            } else {
                var redoData = this.applyChange(
                    this._undoStack.pop(), false );
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

    redo: function redo () {
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

    getUndoData: function getUndoData () {},

    applyChange: function applyChange (/* data, isRedo */) {},
});

var StoreUndoManager = Class({

    Extends: UndoManager,

    init: function init (/* ...mixins */) {
        StoreUndoManager.parent.constructor.apply( this, arguments );
        this.get( 'store' )
            .on( 'willCommit', this, 'saveUndoCheckpoint' )
            .on( 'record:user:create', this, 'dataDidChange' )
            .on( 'record:user:update', this, 'dataDidChange' )
            .on( 'record:user:destroy', this, 'dataDidChange' );
    },

    destroy: function destroy () {
        this.get( 'store' )
            .off( 'willCommit', this, 'saveUndoCheckpoint' )
            .off( 'record:user:create', this, 'dataDidChange' )
            .off( 'record:user:update', this, 'dataDidChange' )
            .off( 'record:user:destroy', this, 'dataDidChange' );
        StoreUndoManager.parent.destroy.call( this );
    },

    dataDidChange: function () {
        var noChanges =
            !this.get( 'store' ).checkForChanges().get( 'hasChanges' );
        this._isInUndoState = noChanges;
        return this
            .set( 'canRedo', noChanges && !!this._redoStack.length )
            .set( 'canUndo', noChanges && !!this._undoStack.length )
            .fire( 'input' );
    },

    getUndoData: function getUndoData () {
        var store = this.get( 'store' );
        return store.checkForChanges().get( 'hasChanges' ) ?
            store.getInverseChanges() : null;
    },

    applyChange: function applyChange ( data ) {
        var store = this.get( 'store' );
        store.applyChanges( data );
        var inverse = store.getInverseChanges();
        store.commitChanges();
        return inverse;
    },
});

/*global document */

var isControl = {
    BUTTON: 1,
    INPUT: 1,
    OPTION: 1,
    SELECT: 1,
    TEXTAREA: 1,
};
var effectToString$1 = effectToString;
var DEFAULT$1 = DEFAULT;

var TouchDragEvent = function TouchDragEvent ( touch ) {
    var clientX = touch.clientX;
    var clientY = touch.clientY;
    var target = document.elementFromPoint( clientX, clientY ) ||
            touch.target;
    this.touch = touch;
    this.clientX = clientX;
    this.clientY = clientY;
    this.target = target;
    this.targetView = getViewFromNode( target );
};

var getTouch = function ( touches, touchId ) {
    var l = touches.length,
        touch;
    // Touch id may be 0 on Android chrome; can't use a falsy check
    if ( touchId === null ) {
        return null;
    }
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
var DragController = new Obj({
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
        Property: O.DragController.drag
        Type: O.Drag|null

        If a drag is in progress, this holds the current <O.Drag> instance.
    */
    drag: null,

    /**
        Method: O.DragController.register

        Called by a new O.Drag instance when it is created to set it as the
        handler for all future drag events. Ends any previous drag if still
        active.

        Parameters:
            drag - {O.Drag} The new drag instance.
    */
    register: function register ( drag ) {
        var oldDrag = this.drag;
        if ( oldDrag ) {
            oldDrag.endDrag();
        }
        this.set( 'drag', drag );
    },

    /**
        Method: O.DragController.deregister

        Called by a new O.Drag instance when it is finished to deregister from
        future drag events.

        Parameters:
            drag - {O.Drag} The finished drag instance.
    */
    deregister: function deregister ( drag ) {
        if ( this.drag === drag ) {
            this.set( 'drag', null );
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
    getNearestDragView: function getNearestDragView ( view ) {
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
        var type;
        try {
            // Firefox sometimes throws a "permission denied" error trying
            // to read any property on the event! Nothing useful we can do
            // with an event like that, so just ignore it.
            type = event.type;
        } catch ( error ) {}
        if ( type ) {
            this.fire( type, event );
        }
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
        if ( event.button || event.metaKey || event.ctrlKey ) {
            return;
        }
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
        var drag = this.drag;
        if ( drag && this._touchId === null ) {
            // Mousemove should only be fired if not native DnD, but sometimes
            // is fired even when there's a native drag
            if ( !drag.get( 'isNative' ) ) {
                drag.move( event );
            }
            // If mousemove during drag, don't propagate to views (for
            // consistency with native DnD).
            event.stopPropagation();
        } else if ( !this._ignore ) {
            var x = event.clientX - this._x;
            var y = event.clientY - this._y;

            if ( ( x*x + y*y ) > 25 ) {
                var view = this.getNearestDragView( this._targetView );
                if ( view ) {
                    new Drag({
                        dragSource: view,
                        event: event,
                        startPosition: {
                            x: this._x,
                            y: this._y,
                        },
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
        var drag = this.drag;
        if ( drag && this._touchId === null ) {
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
        var touch = event.touch;
        var touchEvent = new TouchDragEvent( touch );
        var view = this.getNearestDragView( touchEvent.targetView );
        if ( view && !isControl[ touchEvent.target.nodeName ] ) {
            this.set( 'drag', new Drag({
                dragSource: view,
                event: touchEvent,
            }));
            this._touchId = touch.identifier;
        }
    }.on( 'hold' ),

    /**
        Method (private): O.DragController._onTouchstart

        Parameters:
            event - {Event} The touchstart event.
    */
    // Just doing a sanity check to make sure our drag touch isn't orphaned
    _onTouchstart: function ( event ) {
        // Touch id may be 0 on Android chrome; can't use a falsy check
        if ( this._touchId !== null ) {
            var touch = getTouch( event.touches, this._touchId );
            if ( !touch ) {
                this.drag.endDrag();
            }
        }
    }.on( 'touchstart' ),

    /**
        Method (private): O.DragController._onTouchmove

        Parameters:
            event - {Event} The touchmove event.
    */
    _onTouchmove: function ( event ) {
        var touch = getTouch( event.changedTouches, this._touchId );
        if ( touch ) {
            this.drag.move( new TouchDragEvent( touch ) );
            // Don't propagate to views and don't trigger scroll.
            event.preventDefault();
            event.stopPropagation();
        }
    }.on( 'touchmove' ),

    /**
        Method (private): O.DragController._onTouchend

        Parameters:
            event - {Event} The touchend event.
    */
    _onTouchend: function ( event ) {
        var touch = getTouch( event.changedTouches, this._touchId );
        if ( touch ) {
            this.drag.drop( new TouchDragEvent( touch ) ).endDrag();
        }
    }.on( 'touchend' ),

    /**
        Method (private): O.DragController._onTouchcancel

        Parameters:
            event - {Event} The touchcancel event.
    */
    _onTouchcancel: function ( event ) {
        var touch = getTouch( event.changedTouches, this._touchId );
        if ( touch ) {
            this.drag.endDrag();
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
        // We'll do our own drag system for anything implementing O.Draggable
        // Only allow native drag events for anything else (e.g. links and
        // anything marked with a draggable="true" attribute).
        var dragView = this.getNearestDragView( event.targetView );
        if ( dragView ) {
            event.preventDefault();
        } else {
            new Drag({
                event: event,
                isNative: true,
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
        var drag = this.drag;
        var dataTransfer = event.dataTransfer;
        var notify = true;
        // Probably hasn't come via root view controller, so doesn't have target
        // view property
        if ( !event.targetView ) {
            event.targetView = getViewFromNode( event.target );
        }
        if ( !drag ) {
            var effectAllowed;
            // IE10 will throw an error when you try to access this property!
            try {
                effectAllowed = dataTransfer.effectAllowed;
            } catch ( error ) {
                effectAllowed = ALL;
            }
            // Drag from external source
            drag = new Drag({
                event: event,
                isNative: true,
                allowedEffects: effectToString$1.indexOf( effectAllowed ),
            });
        } else {
            var x = event.clientX;
            var y = event.clientY;
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
        var dropEffect = drag.get( 'dropEffect' );
        if ( dropEffect !== DEFAULT$1 ) {
            dataTransfer.dropEffect =
                effectToString$1[ dropEffect & drag.get( 'allowedEffects' ) ];
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
        var drag = this.drag;
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
        var drag = this.drag;
        if ( drag ) {
            if ( drag.get( 'dropEffect' ) !== DEFAULT$1 ) {
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
        var drag = this.drag;
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
        var drag = this.drag;
        if ( drag && lookupKey( event ) === 'Escape' ) {
            drag.endDrag();
        }
    }.on( 'keydown' ),
});

[ 'dragover', 'dragenter', 'dragleave', 'drop', 'dragend' ].forEach( function (type) {
    document.addEventListener( type, DragController, false );
});

ViewEventsController.addEventTarget( DragController, 20 );

/*global document */

/* Issues with native drag and drop.

This system hooks into the native HTML5 drag and drop event system to allow data
to be dragged not just within the window but also between windows and other
applications/the OS itself. However, by default, all drags initiated within the
application will bypass this system and use a custom implementation, as the
native implementation (and indeed the spec) is extremely buggy. Problems (as of
2011-05-13) include:

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

If you want to initiate a drag with data for an external app (e.g. a file
download), you can still do this, by setting a draggable="true" attribute on the
HTML element to be dragged and handling the dragstart event.

Native support is turned on for drop targets though, as there are no
show-stopping bugs here, so this is handled as normal.

*/

/**
    Class: O.Drag

    Extends: O.Object

    Represents a drag operation being performed by a user.
*/
var Drag = Class({

    Extends: Obj,

    /**
        Constructor: O.Drag

        Parameters:
            mixin - {Object} Overrides any properties on the object. Must
                    include an `event` property containing the event object that
                    triggered the drag.
    */
    init: function init ( mixin$$1 ) {
        var event = mixin$$1.event;

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
            y: event.clientY,
        };
        this.defaultCursor = 'default';
        this.dragImage = null;

        Drag.parent.constructor.call( this, mixin$$1 );

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
                dragCursor = this._dragCursor = Element$1.create( 'div', {
                    style: 'position: fixed; z-index: 9999;',
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
        var dragImage = this._dragCursor;
        if ( dragImage ) {
            var cursor = this.get( 'cursorPosition' );
            var offset = this.get( 'dragImageOffset' );
            dragImage.style.left = ( cursor.x + Math.max( offset.x, 5 ) ) +
                'px';
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

            stylesheet = Stylesheet.create( 'o-drag-cursor',
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
            var items = dataTransfer && dataTransfer.items;
            var types = [];
            var hasFiles = false;
            // Safari 11.1 supports the current dataTransfer.items interface,
            // but does not return anything until drop, so appears to have no
            // types. Old interface must be used instead.
            var l = items ? items.length : 0;
            if ( l ) {
                while ( l-- ) {
                    var item = items[l];
                    var itemType = item.type;
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
            if ( dataTransfer && dataTransfer.types ) {
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
    hasDataType: function hasDataType ( type ) {
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
    getFiles: function getFiles ( typeRegExp ) {
        var files = [];
        var dataTransfer = this.event.dataTransfer;
        if ( dataTransfer ) {
            var items;
            if ( ( items = dataTransfer.items ) ) {
                // Current HTML5 DnD interface (Chrome, Firefox 50+, Edge)
                var l = items.length;
                for ( var i = 0; i < l; i += 1 ) {
                    var item = items[i];
                    var itemType = item.type;
                    if ( item.kind === 'file' ) {
                        // Ignore folders
                        if ( !itemType ) {
                            if ( item.getAsEntry &&
                                    !item.getAsEntry().isFile ) {
                                continue;
                            } else if ( item.webkitGetAsEntry &&
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
            } else if ( ( items = dataTransfer.files ) ) {
                // Deprecated HTML5 DnD interface (Firefox <50, IE)
                var l$1 = items.length;
                for ( var i$1 = 0; i$1 < l$1; i$1 += 1 ) {
                    var item$1 = items[i$1];
                    var itemType$1 = item$1.type;
                    // Check it's not a folder (size > 0) and it matches any
                    // type requirements
                    if ( item$1.size &&
                            ( !typeRegExp || typeRegExp.test( itemType$1 ) ) ) {
                        files.push( item$1 );
                    }
                }
            }
        }
        return files;
    },

    /**
        Method: O.Drag#getFileSystemEntries

        Returns:
            {FileSystemEntry[]|null} An array of all file system entries
            represented by the drag.
    */
    getFileSystemEntries: function getFileSystemEntries () {
        var items = this.getFromPath( 'event.dataTransfer.items' );
        var entries = null;
        if ( items ) {
            var l = items.length;
            for ( var i = 0; i < l; i += 1 ) {
                var item = items[i];
                if ( item.kind === 'file' ) {
                    if ( item.getAsEntry ) {
                        if ( !entries ) {
                            entries = [];
                        }
                        entries.push( item.getAsEntry() );
                    } else if ( item.webkitGetAsEntry ) {
                        if ( !entries ) {
                            entries = [];
                        }
                        entries.push( item.webkitGetAsEntry() );
                    }
                }
            }
        }
        return entries;
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
    getDataOfType: function getDataOfType ( type, callback ) {
        var dataSource = this.get( 'dataSource' ) || this.get( 'dragSource' );
        var dataFound = false;
        if ( dataSource && dataSource.get( 'isDragDataSource' ) ) {
            callback( dataSource.getDragDataOfType( type, this ) );
            dataFound = true;
        } else if ( this.isNative ) {
            var dataTransfer = this.event.dataTransfer;
            var items = dataTransfer.items;
            if ( items ) {
                // Current HTML5 DnD interface
                var l = items.length;
                for ( var i = 0; i < l; i += 1 ) {
                    var item = items[i];
                    if ( item.type === type ) {
                        item.getAsString( callback );
                        dataFound = true;
                        break;
                    }
                }
            } else if ( dataTransfer.getData ) {
                // Deprecated HTML5 DnD interface
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
    startDrag: function startDrag () {
        var this$1 = this;

        DragController.register( this );
        this.fire( 'dragStarted' );
        var dragSource = this.get( 'dragSource' );
        // No drag source if drag started in another window/app.
        if ( dragSource ) {
            dragSource.set( 'isDragging', true ).dragStarted( this );

            var allowedEffects = dragSource.get( 'allowedDragEffects' );
            this.set( 'allowedEffects', allowedEffects );

            // Native DnD support.
            if ( this.isNative ) {
                var dataTransfer = this.event.dataTransfer;
                var dataSource = this.get( 'dataSource' ) || dragSource;
                var dataIsSet = false;

                dataTransfer.effectAllowed =
                    effectToString[ this.get( 'allowedEffects' ) ];

                if ( dataSource.get( 'isDragDataSource' ) ) {
                    dataSource.get( 'dragDataTypes' )
                              .forEach( function (type) {
                        if ( type.contains( '/' ) ) {
                            var data = dataSource.getDragDataOfType(
                                type, this$1 );
                            if ( dataTransfer.items ) {
                                // Current HTML5 DnD interface
                                dataTransfer.items.add( data, type );
                            } else if ( dataTransfer.setData ) {
                                // Deprecated HTML5 DnD interface
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
    endDrag: function endDrag () {
        var dropTarget = this.get( 'dropTarget' );
        var dragSource = this.get( 'dragSource' );
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
            RunLoop.cancel( this._scrollInterval );
            this._scrollInterval = null;
        }
        this._setCursor( false );

        this.fire( 'dragEnded' );
        DragController.deregister( this );

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
    move: function move ( event ) {
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
            y: y = event.clientY,
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
    _check: function _check ( view, x, y ) {
        var scroll = this._scrollBounds;
        var outsideTriggerRegionWidth = 15;

        // If we don't have any containing scroll container bounds, recalculate.
        if ( !scroll ||
                x < scroll.l || x > scroll.r || y < scroll.t || y > scroll.b ) {
            scroll = null;
            // Optimise by only reclaculating scrollView bounds when we mouse
            // over a new view.
            if ( view && this._lastTargetView !== view ) {
                var scrollView = this._lastTargetView = view;

                if ( !( scrollView instanceof ScrollView ) ) {
                    scrollView = scrollView.getParent( ScrollView );
                }
                if ( scrollView ) {
                    var bounds = scrollView.get( 'layer' )
                            .getBoundingClientRect();
                    scroll = {
                        l: bounds.left - outsideTriggerRegionWidth,
                        r: bounds.right + outsideTriggerRegionWidth,
                        t: bounds.top - outsideTriggerRegionWidth,
                        b: bounds.bottom + outsideTriggerRegionWidth,
                    };
                    var deltaX = Math.min( 75, bounds.width >> 2 );
                    var deltaY = Math.min( 75, bounds.height >> 2 );
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
            RunLoop.cancel( this._scrollInterval );
            this._scrollInterval = null;
        }
        // And set a new timer if we are currently in a hotspot.
        if ( scroll ) {
            var deltaX$1 = x < scroll.hl ? -10 : x > scroll.hr ? 10 : 0;
            var deltaY$1 = y < scroll.ht ? -10 : y > scroll.hb ? 10 : 0;
            if ( deltaX$1 || deltaY$1 ) {
                this._scrollBy = { x: deltaX$1, y: deltaY$1 };
                this._scrollInterval =
                    RunLoop.invokePeriodically( this._scroll, 100, this );
            }
        }
    },

    /**
        Method (private): O.Drag#_scroll

        Moves the scroll position of the scroll view currently being hovered
        over.
    */
    _scroll: function _scroll () {
        var scrollView = this._scrollView;
        var scrollBy = this._scrollBy;

        if ( scrollView.scrollBy( scrollBy.x, scrollBy.y ) ) {
            var cursor = this.get( 'cursorPosition' );
            var target = document.elementFromPoint( cursor.x, cursor.y );
            if ( target ) {
                this._update( getViewFromNode( target ) );
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
    _update: function _update ( view ) {
        var this$1 = this;

        var currentDrop = this.get( 'dropTarget' );
        var dragSource = this.get( 'dragSource' );

        // Find the current drop Target
        while ( view ) {
            if ( view === currentDrop || (
                    view.get( 'isDropTarget' ) &&
                    view.willAcceptDrag( this$1 ) ) ) {
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
    drop: function drop ( event ) {
        this.event = event;
        var dropEffect = this.dropEffect;
        if ( this.dropTarget &&
                dropEffect !== NONE &&
                dropEffect !== DEFAULT ) {
            this.dropTarget.drop( this );
        }
        return this;
    },
});

/**
    Class: O.DragDataSource

    Represents a set of data for a drag operation. This can either be
    instantiated like so:

        const ddsource = new O.DragDataSource({
            'text/plain': 'My *data*',
            'text/html': 'My <strong>data</strong>'
        });

    or used as a mixin in another class.
*/
var DragDataSource = {
    /**
        Constructor: O.DragDataSource

        Parameters:
            dragData - {Object} An object with data types as keys and the data
                       itself as the values.
    */
    init: function init ( dragData ) {
        if ( !dragData ) {
            dragData = {};
        }
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
    allowedDragEffects: ALL,

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
    getDragDataOfType: function getDragDataOfType ( type/*, drag*/ ) {
        return this._dragData[ type ];
    },
};

/**
    Mixin: O.Draggable

    The Draggable mixin should be applied to views you wish to make draggable.
    Override the methods to get the callbacks you're interested in.
*/
var Draggable = {
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
    dragStarted: function dragStarted (/* drag */) {},

    /**
        Method: O.Draggable#dragMoved

        Called when a drag initiated with this view moves.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dragMoved: function dragMoved (/* drag */) {},

    /**
        Method: O.Draggable#dragEnded

        Called when a drag initiated with this view finishes (no matter where on
        screen it finishes). This method is guaranteed to be called, if and only
        if dragStarted was called on the same view.

        Parameters:
            drag - {O.Drag} The drag instance.
    */
    dragEnded: function dragEnded (/* drag */) {},
};

/*global XMLHttpRequest, FormData, location */

var parseHeaders = function ( allHeaders ) {
    var headers = {};
    var start = 0;
    while ( true ) {
        // Ignore any leading white space
        while ( /\s/.test( allHeaders.charAt( start ) ) ) {
            start += 1;
        }
        // Look for ":"
        var end = allHeaders.indexOf( ':', start );
        if ( end < 0 ) {
            break;
        }
        // Slice out the header name.
        // Convert to lower-case: HTTP2 will always be lower case, but HTTP1
        // may be mixed case, which causes bugs!
        var name = allHeaders.slice( start, end ).toLowerCase();
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
var XHR = Class({
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
    init: function init ( io ) {
        this._isRunning = false;
        this._status = 0;
        this.io = io || null;
        this.xhr = null;
    },

    destroy: function destroy () {
        this.abort();
    },

    /**
        Method: O.XHR#isRunning

        Determines whether a request is currently in progress.

        Returns:
            {Boolean} Is there a request still in progress?
    */
    isRunning: function isRunning () {
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
    getHeader: function getHeader ( name ) {
        try {
            return this.xhr.getResponseHeader( name ) || '';
        } catch ( error ) {
            return '';
        }
    },

    /**
        Method: O.XHR#getResponse

        Returns the response to the request.

        Returns:
            {String|ArrayBuffer|Blob|Document|Object|null} The response.
            (The type is determined by the responseType parameter to #send.)
    */
    getResponse: function getResponse () {
        try {
            return this.xhr.response;
        } catch ( error ) {
            return null;
        }
    },

    /**
        Method: O.XHR#getStatus

        Returns the HTTP status code returned by the server in response to the
        request.

        Returns:
            {Number} The HTTP status code
    */
    getStatus: function getStatus () {
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
            withCredentials - {Boolean} (Optional) (Default false) Whether or
                              not to include credentials in cross-site requests
            responseType - {String} See XMLHttpRequest.responseType for
                           permitted values. This controls the type of
                           {O.XHR#getResponse} and in consequence the {data}
                           field on an {io:success} or {io:failure} event.

        Returns:
            {O.XHR} Returns self.
    */
    send: function send ( method, url, data, headers, withCredentials, responseType ) {
        if ( this._isRunning ) {
            this.abort();
        }
        this._isRunning = true;

        var xhr = this.xhr = new XMLHttpRequest();
        var io = this.io;
        var that = this;

        if ( io ) {
            io.fire( 'io:begin' );
        }

        xhr.open( method, url, this.makeAsyncRequests );
        xhr.withCredentials = !!withCredentials;
        responseType = responseType || '';
        xhr.responseType = responseType;
        // If a browser doesn’t support a particular value (IE 11 with 'json'),
        // xhr.responseType becomes an empty string, and we will need to
        // simulate it ourselves later. (We don’t support IE≤9 which don’t do
        // responseType at all. We assume all the other values will work fine.)
        this._actualResponseType = xhr.responseType !== responseType ?
            responseType : '';
        for ( var name in headers || {} ) {
            // Let the browser set the Content-type automatically if submitting
            // FormData, otherwise it might be missing the boundary marker.
            if ( name !== 'Content-type' || !( data instanceof FormData ) ) {
                xhr.setRequestHeader( name, headers[ name ] );
            }
        }
        xhr.onreadystatechange = function () {
            that._xhrStateDidChange( this );
        };

        if ( xhr.upload ) {
            // FF will force a preflight on simple cross-origin requests if
            // there is an upload handler set. This follows the spec, but the
            // spec is clearly wrong here and Blink/Webkit do not follow it.
            // See https://bugzilla.mozilla.org/show_bug.cgi?id=727412
            // Workaround by not bothering registering an upload progress
            // handler for GET requests, as it's not needed in this case anyway.
            if ( method !== 'GET' ) {
                xhr.upload.addEventListener( 'progress', this, false );
            }
            xhr.addEventListener( 'progress', this, false );
        }

        try {
            xhr.send( data );
        } catch ( error ) {
            // Some browsers can throw a NetworkError under certain conditions
            // for example if this is a synchronous request and there's no
            // network. Treat as an abort.
            this.abort();
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
        var state = xhr.readyState;
        var io = this.io;

        if ( state < 3 || !this._isRunning ) {
            return;
        }

        if ( state === 3 ) {
            if ( io ) {
                io.set( 'uploadProgress', 100 )
                  .fire( 'io:loading' );
            }
            return;
        }

        this._isRunning = false;
        xhr.onreadystatechange = function () {};
        if ( xhr.upload ) {
            xhr.upload.removeEventListener( 'progress', this, false );
            xhr.removeEventListener( 'progress', this, false );
        }

        var status = xhr.status;
        this._status = status;

        if ( io ) {
            var allHeaders = xhr.getAllResponseHeaders();
            var responseHeaders = parseHeaders( allHeaders );
            var response = this.getResponse();
            if ( this._actualResponseType === 'json' ) {
                try {
                    response = JSON.parse( response );
                } catch ( error ) {
                    response = null;
                }
            }
            // IE returns 200 status code when there's no network! But for a
            // real connection there must have been at least one header, so
            // check that's not empty. Except for cross-domain requests no
            // headers may be returned, so also check for a body
            var isSuccess = ( status >= 200 && status < 300 ) &&
                ( !!allHeaders || !!response );
            io.set( 'uploadProgress', 100 )
              .set( 'progress', 100 )
              .set( 'status', status )
              .set( 'responseHeaders', responseHeaders )
              .set( 'response', response )
              .fire( isSuccess ? 'io:success' : 'io:failure', {
                status: status,
                headers: responseHeaders,
                data: response,
              })
              .fire( 'io:end' );
        }
    }.invokeInRunLoop(),

    handleEvent: function ( event ) {
        var io = this.io;
        if ( io && event.type === 'progress' ) {
            var type = event.target === this.xhr ? 'progress' :
                                                     'uploadProgress';
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
    abort: function abort () {
        if ( this._isRunning ) {
            this._isRunning = false;
            var xhr = this.xhr;
            var io = this.io;
            xhr.abort();
            xhr.onreadystatechange = function () {};
            if ( xhr.upload ) {
                xhr.upload.removeEventListener( 'progress', this, false );
                xhr.removeEventListener( 'progress', this, false );
            }
            if ( io ) {
                io.fire( 'io:abort' )
                  .fire( 'io:end' );
            }
        }
        return this;
    },
});

/*global EventSource */

var NativeEventSource = window.EventSource;

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
var EventSource = NativeEventSource ? Class({

    Extends: Obj,

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
            ...mixins - {Object} (optional) Any properties in this object will
                        be added to the new O.EventSource instance before
                        initialisation (so you can pass it getter/setter
                        functions or observing methods).
    */
    init: function init (/* ...mixins */) {
        this._then = 0;
        this._tick = null;

        this.readyState = CLOSED;

        EventSource.parent.constructor.apply( this, arguments );

        var eventTypes = [ 'open', 'message', 'error' ];
        var observers = meta( this ).observers;
        for ( var type in observers ) {
            if ( /^__event__/.test( type ) ) {
                eventTypes.include( type.slice( 9 ) );
            }
        }
        this._eventTypes = eventTypes;
    },

    on: function on ( type ) {
        var types = this._eventTypes;
        var eventSource = this._eventSource;
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
    _check: function _check () {
        var now = Date.now();
        if ( now - this._then > 67500 ) {
            this.fire( 'restart' )
                .close()
                .open();
        } else {
            this._then = now;
            this._tick =
                RunLoop.invokeAfterDelay( this._check, 60000, this );
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
                RunLoop.cancel( tick );
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
    open: function open () {
        var this$1 = this;

        if ( this.get( 'readyState' ) === CLOSED ) {
            var eventSource = this._eventSource =
                new NativeEventSource( this.get( 'url' ) );

            this._eventTypes.forEach(
                function (type) { return eventSource.addEventListener( type, this$1, false ); }
            );

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
    close: function close () {
        return this.set( 'readyState', CLOSED );
    },

    /**
        Method (private): O.EventSource#_sourceDidClose

        Removes event listeners and then the reference to an event source after
        it closes, as they cannot be reused.
    */
    _sourceDidClose: function () {
        var this$1 = this;

        if ( this.get( 'readyState' ) === CLOSED ) {
            var eventSource = this._eventSource;
            var types = this._eventTypes;
            var l = types.length;
            eventSource.close();
            while ( l-- ) {
                eventSource.removeEventListener( types[l], this$1, false );
            }
            this._eventSource = null;
        }
    }.observes( 'readyState' ),
}) : Class({

    Extends: Obj,

    readyState: CONNECTING,

    init: function init (/* ...mixins */) {
        EventSource.parent.constructor.apply( this, arguments );
        this._xhr = new XHR( this );
    },

    open: function open () {
        var headers = {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
        };
        if ( this._lastEventId ) {
            headers[ 'Last-Event-ID' ] = this._lastEventId;
        }

        this.set( 'readyState', CONNECTING );
        this._data = '';
        this._eventName = '';
        this._processedIndex = 0;
        this._lastNewLineIndex = 0;
        this._xhr.send( 'GET', this.get( 'url' ), null, headers );
        return this;
    },

    close: function close () {
        if ( this.get( 'readyState' ) !== CLOSED ) {
            this._xhr.abort();
            this.set( 'readyState', CLOSED );
        }
        return this;
    },

    _reconnectAfter: 30000,
    _lastEventId: '',

    // ---

    _dataDidArrive: function () {
        var xhr = this._xhr;
        // Must start with text/event-stream (i.e. indexOf must === 0)
        // If it doesn't, fail the connection.
        // IE doesn't let you read headers in the loading phase, so if we don't
        // know the response type, we'll just presume it's correct.
        var contentType = xhr.getHeader( 'Content-type' );
        if ( contentType && contentType.indexOf( 'text/event-stream' ) !== 0 ) {
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

    _openConnection: function _openConnection () {
        if ( this.get( 'readyState' ) === CONNECTING ) {
            this.set( 'readyState', OPEN )
                .fire( 'open' );
        }
    },

    _failConnection: function _failConnection () {
        this.close()
            .fire( 'error' );
    },

    _reconnect: function _reconnect () {
        RunLoop.invokeAfterDelay(
            this.open, this._reconnectAfter, this );
    },

    _processData: function _processData ( text ) {
        var this$1 = this;

        // Look for a new line character since the last processed
        var lastIndex = this._lastNewLineIndex;
        var newLine = /\u000d\u000a?|\u000a/g;

        // One leading U+FEFF BYTE ORDER MARK character must be ignored if any
        // are present.
        if ( !lastIndex && text.charAt( 0 ) === '\ufeff' ) {
            lastIndex = 1;
        }
        newLine.lastIndex = this._processedIndex;
        var match;
        while ( match = newLine.exec( text ) ) {
            this$1._processLine( text.slice( lastIndex, match.index ) );
            lastIndex = newLine.lastIndex;
        }
        this._lastNewLineIndex = lastIndex;
        this._processedIndex = text.length;
    },

    _processLine: function _processLine ( line ) {
        // Blank line, dispatch event
        if ( /^\s*$/.test( line ) ) {
            this._dispatchEvent();
        } else {
            var colon = line.indexOf( ':' );
            // Line starts with colon -> ignore.
            if ( !colon ) {
                return;
            }
            var field = line;
            var value = '';
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

    _dispatchEvent: function _dispatchEvent () {
        var data = this._data;
        if ( data ) {
            if ( data.slice( -1 ) === '\u000a' ) {
                data = data.slice( 0, -1 );
            }
            this.fire( this._eventName || 'message', {
                data: data,
                // origin: '',
                lastEventId: this._lastEventId,
            });
        }
        this._data = '';
        this._eventName = '';
    },
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
EventSource.CONNECTING = CONNECTING;
EventSource.OPEN = OPEN;
EventSource.CLOSED = CLOSED;

/*global location */

/**
    Class: O.HttpRequest

    Extends: O.Object

    The O.HttpRequest class represents an HTTP request. It will automatically
    choose between an XHR and an iframe form submission for uploading form data,
    depending on browser support.
*/

var HttpRequest = Class({

    Extends: Obj,

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
        'Accept': 'application/json, */*',
    },

    /**
        Property: O.HttpRequest#withCredentials
        Type: Boolean
        Default: false

        Send cookies with cross-domain requests?
    */
    withCredentials: false,

    /**
        Property: O.HttpRequest#responseType
        Type: String
        Default: ''

        What type should {data} in an {io:success} or {io:failure} event be?
        Refer to {XMLHttpRequest.responseType} for permitted values.
    */
    responseType: '',

    // ---

    init: function init (/* ...mixins */) {
        this._transport = null;
        this._timer = null;
        this._lastActivity = 0;

        this.uploadProgress = 0;
        this.progress = 0;

        this.status = 0;
        this.responseHeaders = {};
        this.response = '';

        HttpRequest.parent.constructor.apply( this, arguments );
    },

    // ---

    setTimeout: function () {
        var timeout = this.get( 'timeout' );
        if ( timeout ) {
            this._lastActivity = Date.now();
            this._timer = RunLoop.invokeAfterDelay(
                this.didTimeout, timeout, this );
        }
    }.on( 'io:begin' ),

    resetTimeout: function () {
        this._lastActivity = Date.now();
    }.on( 'io:uploadProgress', 'io:loading', 'io:progress' ),

    clearTimeout: function () {
        var timer = this._timer;
        if ( timer ) {
            RunLoop.cancel( timer );
        }
    }.on( 'io:end' ),

    didTimeout: function didTimeout () {
        this._timer = null;
        var timeout = this.get( 'timeout' );
        var timeSinceLastReset = Date.now() - this._lastActivity;
        var timeToTimeout = timeout - timeSinceLastReset;
        // Allow for 10ms jitter
        if ( timeToTimeout < 10 ) {
            this.fire( 'io:timeout' )
                .abort();
        } else {
            this._timer = RunLoop.invokeAfterDelay(
                this.didTimeout, timeToTimeout, this );
        }
    },

    // ---

    send: function send () {
        var method = this.get( 'method' ).toUpperCase();
        var url = this.get( 'url' );
        var data = this.get( 'data' ) || null;
        var headers = this.get( 'headers' );
        var withCredentials = this.get( 'withCredentials' );
        var responseType = this.get( 'responseType' );
        var transport = new XHR();

        if ( data && method === 'GET' ) {
            url += ( url.contains( '?' ) ? '&' : '?' ) + data;
            data = null;
        }
        var contentType = headers[ 'Content-type' ];
        if ( contentType && method === 'POST' && typeof data === 'string' &&
                contentType.indexOf( ';' ) === -1 ) {
            // All string data is sent as UTF-8 by the browser.
            // This cannot be altered.
            headers[ 'Content-type' ] += ';charset=utf-8';
        }

        // Send the request
        this._transport = transport;
        transport.io = this;
        transport.send( method, url, data, headers, withCredentials,
            responseType );

        return this;
    },

    abort: function abort () {
        var transport = this._transport;
        if ( transport && transport.io === this ) {
            transport.abort();
        }
    },

    _releaseXhr: function () {
        var transport = this._transport;
        if ( transport instanceof XHR ) {
            transport.io = null;
            this._transport = null;
        }
    }.on( 'io:success', 'io:failure', 'io:abort' ),

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
        data    - The data returned by the response.
    */

    /**
        Event: io:failure

        This event is fired if the request completes unsuccessfully (normally
        determined by the HTTP status code). It includes the following
        properties:

        status  - The HTTP status code of the response.
        headers - The headers of the response.
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

/**
    Module: IO

    The IO module provides classes for two-way communication with a server.
*/

/**
    Class: O.IOQueue

    Extends: O.Object

    Manage concurrent HTTP requests.
*/

var QUEUE = 1;
var IGNORE = 2;
var ABORT = 3;

var IOQueue = Class({

    Extends: Obj,

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
            ...mixins - {Object} An object containing new defaults for any of
                        the public properties defined on the object. Can also
                        contain methods to override the normal methods to create
                        an anonymous subclass.
    */
    init: function init (/* ...mixins */) {
        this._queue = [];
        this._recent = null;
        this.activeConnections = 0;

        IOQueue.parent.constructor.apply( this, arguments );
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
    send: function send ( request ) {
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
    abort: function abort ( request ) {
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
    }.on( 'io:end' ),
});

IOQueue.QUEUE = 1;
IOQueue.IGNORE = 2;
IOQueue.ABORT = 3;

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
    var durationInSeconds = Math.abs( Math.floor( durationInMS / 1000 ) );
    var time, weeks, days, hours, minutes;

    if ( durationInSeconds < 60 ) {
        if ( approx ) {
            time = loc( 'less than a minute' );
        } else {
            time = loc( '[*2,_1,%n second,%n seconds]', durationInSeconds );
        }
    } else if ( durationInSeconds < 60 * 60 ) {
        time = loc( '[*2,_1,%n minute,%n minutes]',
            ~~( durationInSeconds / 60 ) );
    } else if ( durationInSeconds < 60 * 60 * 24 ) {
        if ( approx ) {
            hours = Math.round( durationInSeconds / ( 60 * 60 ) );
            minutes = 0;
        } else {
            hours = ~~( durationInSeconds / ( 60 * 60 ) );
            minutes = ~~( ( durationInSeconds / 60 ) % 60 );
        }
        time = loc( '[*2,_1,%n hour,%n hours,] [*2,_2,%n minute,%n minutes,]',
            hours, minutes );
    } else if ( approx ? durationInSeconds < 60 * 60 * 24 * 21 :
            durationInSeconds < 60 * 60 * 24 * 7 ) {
        if ( approx ) {
            days = Math.round( durationInSeconds / ( 60 * 60 * 24 ) );
            hours = 0;
        } else {
            days = ~~( durationInSeconds / ( 60 * 60 * 24 ) );
            hours = ~~( ( durationInSeconds / ( 60 * 60 ) ) % 24 );
        }
        time = loc( '[*2,_1,%n day,%n days,] [*2,_2,%n hour,%n hours,]',
            days, hours );
    } else {
        if ( approx ) {
            weeks = Math.round( durationInSeconds / ( 60 * 60 * 24 * 7 ) );
            days = 0;
        } else {
            weeks = ~~( durationInSeconds / ( 60 * 60 * 24 * 7 ) );
            days = ~~( durationInSeconds / ( 60 * 60 * 24 ) ) % 7;
        }
        time = loc( '[*2,_1,%n week,%n weeks,] [*2,_2,%n day,%n days,]',
            weeks, days );
    }
    return time.trim();
};

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
        mustNotBeFuture - {Boolean} (optional) If true and a date is supplied in
                          the future, it is assumed this is due to clock skew
                          and the string "just now" is always returned.

    Returns:
        {String} Relative date string.
*/
Date.prototype.relativeTo = function ( date, approx, mustNotBeFuture ) {
    if ( !date ) {
        date = new Date();
    }

    var duration = ( date - this );
    var isFuture = ( duration < 0 );
    var time, years, months;

    if ( isFuture ) {
        duration = -duration;
    }
    if ( !duration || ( isFuture && mustNotBeFuture ) ) {
        return loc( 'just now' );
    // Less than a day
    } else if ( duration < 1000 * 60 * 60 * 24 ) {
        time = formatDuration( duration, approx );
    // Less than 6 weeks
    } else if ( duration < 1000 * 60 * 60 * 24 * 7 * 6 ) {
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
    } else {
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
            loc( '[*2,_1,%n year,%n years,] [*2,_2,%n month,%n months,]',
                years, months ).trim();
    }

    return isFuture ?
        loc( '[_1] from now', time ) : loc( '[_1] ago', time );
};

// TODO(cmorgan/modulify): do something about these exports: Date#relativeTo,
// Date.formatDuration

var Parse = Class({
    init: function init ( string, tokens ) {
        this.string = string;
        this.tokens = tokens || [];
    },
    clone: function clone$$1 () {
        return new Parse( this.string, this.tokens.slice() );
    },
    assimilate: function assimilate ( parse ) {
        this.string = parse.string;
        this.tokens = parse.tokens;
    },
});

Parse.define = function ( name, regexp, context ) {
    return function ( parse ) {
        var string = parse.string;
        var result = regexp.exec( string );
        if ( result ) {
            var part = result[0];
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
    if ( !max ) {
        max = 2147483647;
    }
    return function ( parse ) {
        var newParse = parse.clone();
        var i = 0;
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
        var parses = [];
        var l = patterns.length;
        for ( var i = 0; i < l; i += 1 ) {
            var newParse = parse.clone();
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
            var newParse$1 = parses[l];
            while ( l-- ) {
                if ( parses[l].string.length <= newParse$1.string.length ) {
                    newParse$1 = parses[l];
                }
            }
            parse.assimilate( newParse$1 );
            return true;
        }
        return false;
    };
};

// --- Date Grammar ---

var JUST_TIME = 1;
var JUST_DATE = 2;
var DATE_AND_TIME = 3;

var generateLocalisedDateParser = function ( locale, mode ) {
    var define = Parse.define;
    var optional = Parse.optional;
    var not = Parse.not;
    var sequence = Parse.sequence;
    var firstMatch = Parse.firstMatch;
    var longestMatch = Parse.longestMatch;

    var datePatterns = locale.datePatterns;

    var anyInLocale = function ( type, names ) {
        return firstMatch(
            names.split( ' ' )
                 .map( function (name) { return define( type, datePatterns[ name ], name ); } )
        );
    };

    var whitespace = define( 'whitespace', (/^(?:[\s"']+|$)/) );

    var hours = define( 'hour', /^(?:2[0-3]|[01]?\d)/ );
    var shorthours = define( 'hour', /^[12]/ );
    var minutes = define( 'minute', /^[0-5][0-9]/ );
    var seconds = define( 'second', /^[0-5][0-9]/ );
    var meridian = firstMatch([
        define( 'am', datePatterns.am ),
        define( 'pm', datePatterns.pm ) ]);
    var timeSuffix = sequence([
        optional( whitespace ),
        meridian ]);
    var timeDelimiter = define( 'timeDelimiter', ( /^[:.]/ ) );
    var timeContext = define( 'timeContext', datePatterns.timeContext );
    var time = firstMatch([
        sequence([
            hours,
            optional( sequence([
                timeDelimiter,
                minutes,
                optional( sequence([
                    timeDelimiter,
                    seconds ])) ])),
            optional(
                timeSuffix
            ),
            whitespace ]),
        sequence([
            firstMatch([
                sequence([
                    hours,
                    minutes ]),
                sequence([
                    shorthours,
                    minutes ]) ]),
            optional(
                timeSuffix
            ),
            whitespace ]) ]);

    if ( mode === JUST_TIME ) {
        return firstMatch([
            time,
            whitespace ]);
    }

    var ordinalSuffix = define( 'ordinalSuffix', datePatterns.ordinalSuffix );

    var weekday = anyInLocale( 'weekday', 'sun mon tue wed thu fri sat' );
    var day = sequence([
            define( 'day', /^(?:[0-2]\d|3[0-1]|\d)/ ),
            optional( ordinalSuffix ),
            not( timeContext ) ]);
    var monthnumber = sequence([
            define( 'month', /^(?:1[0-2]|0\d|\d)/ ),
            not( firstMatch([
                timeContext,
                ordinalSuffix ])) ]);
    var monthname = anyInLocale( 'monthname',
            'jan feb mar apr may jun jul aug sep oct nov dec' );
    var month = firstMatch([
            monthnumber,
            monthname ]);
    var fullyear = define( 'year', /^\d{4}/ );
    var year = sequence([
            define( 'year', /^\d\d(?:\d\d)?/ ),
            not( firstMatch([
                timeContext,
                ordinalSuffix ])) ]);
    var searchMethod = anyInLocale( 'searchMethod', 'past future' );

    var dateDelimiter = define( 'dateDelimiter', /^(?:[\s\-.,'/]|of)+/ );

    var relativeDate = anyInLocale( 'relativeDate',
            'yesterday tomorrow today now' );

    var adjustSign = define( 'adjustSign', /^[+-]/ );
    var adjustUnit = define( 'adjustUnit',
            /^(?:day|week|month|year)|[dwmy]/i );
    var adjustNumber = define( 'adjustNumber', /^\d+/ );
    var adjust = sequence([
        optional( adjustSign ),
        adjustNumber,
        optional( whitespace ),
        adjustUnit ]);

    var standardDate = sequence(
            locale.dateFormats.date.split( /%-?([dmbY])/ ).map(
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
            }).filter( function (x) { return x; } )
        );

    var dayMonthYear = sequence([
            day,
            dateDelimiter,
            month,
            dateDelimiter,
            year ]);
    var dayMonth = sequence([
            day,
            dateDelimiter,
            month ]);
    var monthYear = sequence([
            month,
            dateDelimiter,
            year,
            not( timeContext ) ]);
    var monthDayYear = sequence([
            month,
            dateDelimiter,
            day,
            dateDelimiter,
            year ]);
    var monthDay = sequence([
            month,
            dateDelimiter,
            day ]);
    var yearMonthDay = sequence([
            year,
            dateDelimiter,
            month,
            dateDelimiter,
            day ]);
    var yearMonth = sequence([
            year,
            dateDelimiter,
            month ]);

    var date = sequence([
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
                        yearMonth ] : locale.dateElementOrder === 'mdy' ?     [
                        monthDayYear,
                        monthDay,
                        monthYear,
                        dayMonthYear,
                        dayMonth,
                        yearMonthDay,
                        yearMonth ] : [
                        yearMonthDay,
                        yearMonth,
                        dayMonthYear,
                        dayMonth,
                        monthYear,
                        monthDayYear,
                        monthDay ]
                ) ]),
            not( define( '', /^\d/ ) ) ]);

    if ( mode === JUST_DATE ) {
        return firstMatch([
            date,
            weekday,
            fullyear,
            monthname,
            relativeDate,
            adjust,
            day,
            searchMethod,
            whitespace ]);
    }

    return firstMatch([
        date,
        weekday,
        fullyear,
        monthname,
        relativeDate,
        adjust,
        day,
        time,
        searchMethod,
        whitespace ]);
};

// --- Interpreter ---

var monthNameToIndex = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
};

var dayNameToIndex = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
};

var letterToUnit = {
    d: 'day',
    w: 'week',
    m: 'month',
    y: 'year',
};

var isLeapYear$1 = Date.isLeapYear;
var getDaysInMonth = Date.getDaysInMonth;

var NOW = 0;
var PAST = -1;
var FUTURE = 1;

var interpreter = {
    interpret: function interpret ( tokens, implicitSearchMethod ) {
        var this$1 = this;

        var date = {};
        var l = tokens.length;
        for ( var i = 0; i < l; i += 1 ) {
            var token = tokens[i];
            var name = token[0];
            if ( this$1[ name ] ) {
                this$1[ name ]( date, token[1], token[2], tokens );
            }
        }
        return this.findDate( date, date.searchMethod || implicitSearchMethod );
    },
    findDate: function findDate ( constraints, searchMethod ) {
        var keys = Object.keys( constraints );
        if ( !keys.length ) {
            return null;
        }
        var date = new Date();
        var currentDay = date.getDate();

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
        var day = constraints.day;
        var month = constraints.month;
        var year = constraints.year;
        var weekday = constraints.weekday;
        var adjust = constraints.adjust;

        var hasMonth = !!( month || month === 0 );
        var hasWeekday = !!( weekday || weekday === 0 );

        var dayInMs = 86400000;
        var currentMonth, isFeb29, delta;

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
                    while ( !isLeapYear$1( year ) ) {
                        year += ( searchMethod || 1 );
                    }
                    date.setFullYear( year );
                }
                delta = ( isFeb29 ? 4 : 1 ) * ( searchMethod || 1 );
                while ( date.getDay() !== weekday ) {
                    do {
                        year += delta;
                    } while ( isFeb29 && !isLeapYear$1( year ) );
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
        } else /* Default to today */ {
            date.setDate( currentDay );
        }

        if ( adjust ) {
            for ( var i = 0, l = adjust.length; i < l; i += 1 ) {
                date.add( adjust[i][0], adjust[i][1] );
            }
        }

        return date;
    },

    weekday: function weekday ( date, string, weekday$1 ) {
        date.weekday = dayNameToIndex[ weekday$1 ];
    },
    day: function day ( date, string ) {
        date.day = +string;
    },
    month: function month ( date, string ) {
        date.month = +string - 1;
    },
    monthname: function monthname ( date, string, name ) {
        date.month = monthNameToIndex[ name ];
    },
    year: function year ( date, string ) {
        var year = +string;
        if ( string.length === 2 ) {
            year += 2000;
            if ( year > new Date().getFullYear() + 30 ) {
                year -= 100;
            }
        }
        date.year = year;
    },
    hour: function hour ( date, string ) {
        date.hour = +string;
        var meridian = date.meridian;
        if ( meridian ) {
            this[ meridian ]( date );
        }
    },
    minute: function minute ( date, string ) {
        date.minute = +string;
    },
    second: function second ( date, string ) {
        date.second = +string;
    },
    am: function am ( date ) {
        date.meridian = 'am';
        var hour = date.hour;
        if ( hour && hour === 12 ) {
            date.hour = 0;
        }
    },
    pm: function pm ( date ) {
        date.meridian = 'pm';
        var hour = date.hour;
        if ( hour && hour < 12 ) {
            date.hour = hour + 12;
        }
    },
    searchMethod: function searchMethod ( date, string, pastOrFuture ) {
        date.searchMethod = ( pastOrFuture === 'past' ) ? PAST : FUTURE;
    },
    relativeDate: function relativeDate ( date, string, context ) {
        var now = new Date();
        var dayInMs = 86400000;
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
    },
    adjustSign: function adjustSign ( date, sign ) {
        if ( !date.adjust ) {
            date.adjust = [];
        }
        date.adjust.push([ sign === '+' ? 1 : -1, 'day' ]);
    },
    adjustNumber: function adjustNumber ( date, number ) {
        if ( !date.adjust ) {
            date.adjust = [[ -1, 'day' ]];
        }
        date.adjust.last()[0] *= number;
    },
    adjustUnit: function adjustUnit ( date, unit ) {
        unit = unit.toLowerCase();
        unit = letterToUnit[ unit ] || unit;
        date.adjust.last()[1] = unit;
    },
};

// ---

var unknown = Parse.define( 'unknown', /^[^\s]+/ );

var dateParsers = {};
var parseDateTime = function ( string, locale, mode ) {
    if ( !locale ) {
        locale = LocaleController.getLocale();
    }
    string = string.trim().replace(/[０-９]/g,
        function (wideNum) { return String.fromCharCode( wideNum.charCodeAt( 0 ) - 65248 ); }
    );
    var code = locale.code + mode;
    var dateParser = dateParsers[ code ] ||
        ( dateParsers[ code ] = generateLocalisedDateParser( locale, mode ) );
    var parse = new Parse( string );
    while ( parse.string.length ) {
        if ( !dateParser( parse ) ) {
            // We've hit something unexpected. Skip it.
            unknown( parse );
        }
    }
    return parse.tokens;
};

var interpretDateTime = function ( tokens, implicitSearchMethod ) {
    return interpreter.interpret( tokens, implicitSearchMethod || NOW );
};

var time = function ( string, locale ) {
    var tokens = parseDateTime( string, locale, JUST_TIME );
    return interpreter.interpret( tokens );
};

var date = function ( string, locale, implicitPast ) {
    var tokens = parseDateTime( string, locale, JUST_DATE );
    return interpreter.interpret( tokens, implicitPast ? PAST : NOW );
};

var dateTime = function ( string, locale, implicitPast ) {
    var tokens = parseDateTime( string, locale, DATE_AND_TIME );
    return interpreter.interpret( tokens, implicitPast ? PAST : NOW );
};

var DateParser = {
    tokeniseDateTime: parseDateTime,
    interpretDateTime: interpretDateTime,
    time: time,
    date: date,
    dateTime: dateTime,
};

var SelectionController = Class({

    Extends: Obj,

    content: null,
    visible: null,

    init: function init (/* ...mixins */) {
        this._selectionId = 0;
        this._lastSelectedIndex = 0;
        this._selectedStoreKeys = {};

        this.isLoadingSelection = false;
        this.length = 0;

        SelectionController.parent.constructor.apply( this, arguments );

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
        this.selectNone();
    }.observes( 'content' ),

    visibleDidChange: function () {
        this._lastSelectedIndex = 0;
    }.observes( 'visible' ),

    contentWasUpdated: function contentWasUpdated ( event ) {
        // If an id has been removed, it may no
        // longer belong to the selection
        var _selectedStoreKeys = this._selectedStoreKeys;
        var length = this.get( 'length' );
        var removed = event.removed;
        var added = event.added.reduce( function ( set, storeKey ) {
            set[ storeKey ] = true;
            return set;
        }, {} );
        var l = removed.length;
        var storeKey;

        while ( l-- ) {
            storeKey = removed[l];
            if ( _selectedStoreKeys[ storeKey ] && !added[ storeKey ] ) {
                length -= 1;
                delete _selectedStoreKeys[ storeKey ];
            }
        }

        this.set( 'length', length )
            .propertyDidChange( 'selectedStoreKeys' );
    },

    // ---

    selectedStoreKeys: function () {
        return Object.keys( this._selectedStoreKeys );
    }.property().nocache(),

    isStoreKeySelected: function isStoreKeySelected ( storeKey ) {
        return !!this._selectedStoreKeys[ storeKey ];
    },

    getSelectedRecords: function getSelectedRecords ( store ) {
        return this.get( 'selectedStoreKeys' ).map(
            function (storeKey) { return store.getRecordFromStoreKey( storeKey ); }
        );
    },

    // ---

    selectStoreKeys: function selectStoreKeys ( storeKeys, isSelected, _selectionId ) {
        if ( _selectionId && _selectionId !== this._selectionId ) {
            return;
        }
        // Make sure we've got a boolean
        isSelected = !!isSelected;

        var _selectedStoreKeys = this._selectedStoreKeys;
        var howManyChanged = 0;
        var l = storeKeys.length;
        var storeKey, wasSelected;

        while ( l-- ) {
            storeKey = storeKeys[l];
            wasSelected = !!_selectedStoreKeys[ storeKey ];
            if ( isSelected !== wasSelected ) {
                if ( isSelected ) {
                    _selectedStoreKeys[ storeKey ] = true;
                } else {
                    delete _selectedStoreKeys[ storeKey ];
                }
                howManyChanged += 1;
            }
        }

        if ( howManyChanged ) {
            this.increment( 'length',
                    isSelected ? howManyChanged : -howManyChanged )
                .propertyDidChange( 'selectedStoreKeys' );
        }

        this.set( 'isLoadingSelection', false );
    },

    selectIndex: function selectIndex ( index, isSelected, includeRangeFromLastSelected ) {
        var lastSelectedIndex = this._lastSelectedIndex;
        var start = includeRangeFromLastSelected ?
                Math.min( index, lastSelectedIndex ) : index;
        var end = ( includeRangeFromLastSelected ?
                Math.max( index, lastSelectedIndex ) : index ) + 1;
        this._lastSelectedIndex = index;
        return this.selectRange( start, end, isSelected );
    },

    selectRange: function selectRange ( start, end, isSelected ) {
        var this$1 = this;

        var query = this.get( 'visible' ) || this.get( 'content' );
        var selectionId = ( this._selectionId += 1 );
        var loading = query.getStoreKeysForObjectsInRange(
            start, Math.min( end, query.get( 'length' ) || 0 ),
            function ( storeKeys, start, end ) {
                this$1.selectStoreKeys( storeKeys,
                    isSelected, selectionId, start, end );
            }
        );

        if ( loading ) {
            this.set( 'isLoadingSelection', true );
        }

        return this;
    },

    selectAll: function selectAll () {
        var this$1 = this;

        var query = this.get( 'visible' ) || this.get( 'content' );
        var selectionId = ( this._selectionId += 1 );
        var loading = query.getStoreKeysForAllObjects(
            function ( storeKeys, start, end ) {
                this$1.selectStoreKeys( storeKeys,
                    true, selectionId, start, end );
            }
        );

        if ( loading ) {
            this.set( 'isLoadingSelection', true );
        }

        return this;
    },

    selectNone: function selectNone () {
        this._lastSelectedIndex = 0;
        this._selectedStoreKeys = {};
        this.set( 'length', 0 )
            .propertyDidChange( 'selectedStoreKeys' )
            .set( 'isLoadingSelection', false );

        return this;
    },
});

var SingleSelectionController = Class({

    Extends: Obj,

    allowNoSelection: true,

    init: function init (/* ...mixins */) {
        this._ignore = false;
        this._range = { start: -1, end: 0 };

        this.content = null;
        this.record = null;
        this.index = -1;
        this.isFetchingIndex = false;

        SingleSelectionController.parent.constructor.apply( this, arguments );

        var content = this.get( 'content' );
        if ( content ) {
            this.contentDidChange( null, '', null, content );
        }
    },

    destroy: function destroy () {
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
        var list = this.get( 'content' );
        var length = list ? list.get( 'length' ) : 0;
        var index = this.get( 'index' );
        var range = this._range;
        range.start = index;
        range.end = index + 1;
        if ( !this._ignore ) {
            if ( ( index < 0 && !this.get( 'allowNoSelection' ) ) ||
                    ( !length && index > 0 ) ) {
                this.set( 'index', 0 );
            } else if ( length > 0 && index >= length ) {
                this.set( 'index', length - 1 );
            } else {
                var record;
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
        var this$1 = this;

        if ( !this._ignore ) {
            // If both content and record are bound, content *must* be synced
            // first in order to look for the new record in the new list.
            var binding = meta( this ).bindings.content;
            if ( binding ) {
                this._ignore = true;
                binding.sync();
                this._ignore = false;
            }
            var record = this.get( 'record' );
            var list = this.get( 'content' );
            if ( record && list ) {
                this.set( 'isFetchingIndex', true );
                list.indexOfStoreKey(
                    record.get( 'storeKey' ),
                    0,
                    function (index) {
                        if ( this$1.get( 'record' ) === record &&
                                this$1.get( 'content' ) === list ) {
                            this$1._ignore = true;
                            this$1.set( 'index', index );
                            this$1._ignore = false;
                            this$1.set( 'isFetchingIndex', false );
                        }
                    }
                );
            } else if ( record || this.get( 'allowNoSelection' ) ) {
                this._ignore = true;
                this.set( 'index', -1 );
                this._ignore = false;
            }
        }
    }.observes( 'record' ),

    setRecordInNewContent: function setRecordInNewContent ( list ) {
        // If fetching an explicit index, we've already set the explicit
        // record we want; don't change it.
        if ( this.get( 'isFetchingIndex' ) ) {
            return;
        }
        // If we're about to sync a new record, nothing to do
        var binding = meta( this ).bindings.record;
        if ( binding && binding.isNotInSync && binding.willSyncForward ) {
            return;
        }

        var allowNoSelection = this.get( 'allowNoSelection' );
        var record = this.get( 'record' );
        var index = allowNoSelection ? -1 : 0;

        // Race condition check: has the content property changed since the
        // SingleSelectionController#contentBecameReady call?
        if ( list !== this.get( 'content' ) ) {
            return;
        }

        // See if the currently set record exists in the new list. If it does,
        // we'll use that.
        if ( record ) {
            index = list.indexOfStoreKey( record.get( 'storeKey' ) );
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
                // If no oldVal but record, presume it was an explicit set.
                if ( !oldVal && this.get( 'record' ) ) {
                    this._recordDidChange();
                } else if ( newVal.is( READY ) ) {
                    this.setRecordInNewContent( newVal );
                } else {
                    newVal.addObserverForKey(
                        'status', this, 'contentBecameReady' );
                }
            }
        }
    }.observes( 'content' ),

    contentBecameReady: function contentBecameReady ( list, key ) {
        if ( list.is( READY ) ) {
            list.removeObserverForKey( key, this, 'contentBecameReady' );
            // Queue so that all data from the server will have been loaded
            // into the list.
            RunLoop.queueFn( 'before',
                this.setRecordInNewContent.bind( this, list ) );
        }
    },

    contentWasUpdated: function contentWasUpdated ( updates ) {
        var record = this.get( 'record' );
        var index = record ?
                updates.added.indexOf( record.get( 'storeKey' ) ) : -1;
        var removedIndexes = updates.removedIndexes;
        var addedIndexes = updates.addedIndexes;
        var content = this.get( 'content' );

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
            var l = removedIndexes.length;
            var change = 0;
            for ( var i = 0; i < l; i += 1 ) {
                if ( removedIndexes[i] < index ) {
                    change += 1;
                } else {
                    // Guaranteed in ascending order.
                    break;
                }
            }
            index -= change;
            l = addedIndexes.length;
            for ( var i$1 = 0; i$1 < l; i$1 += 1 ) {
                if ( addedIndexes[i$1] <= index ) {
                    index += 1;
                } else {
                    // Guaranteed in ascending order.
                    break;
                }
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

    contentWasReset: function contentWasReset () {
        this._recordDidChange();
    },
});

/*global location, sessionStorage, localStorage */

/**
    Module: Storage

    The Storage module provides classes for persistant storage in the client.
*/

var dummyStorage = {
    setItem: function setItem () {},
    getItem: function getItem () {},
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
var LocalStorage = Class({

    Extends: Obj,

    /**
        Constructor: O.LocalStorage

        Parameters:
            name        - {String} The name of this storage set. Objects with
                          the same name will overwrite each others' values.
            sessionOnly - {Boolean} (optional) Should the values only be
                          persisted for the session?
    */
    init: function init ( name, sessionOnly ) {
        this._name = name + '.';
        this._store = location.protocol === 'file:' ? dummyStorage :
            sessionOnly ? sessionStorage : localStorage;

        LocalStorage.parent.constructor.call( this );
    },

    get: function get ( key ) {
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

    set: function set ( key, value ) {
        // If we exceed the storage quota, an error will be thrown.
        try {
            this._store.setItem( this._name + key, JSON.stringify( value ) );
        } catch ( error ) {}
        return LocalStorage.parent.set.call( this, key, value );
    },
});

// Periods format:
// until posix time, offset (secs), rules name, suffix
// e.g. [ +new Date(), -3600, 'EU', 'CE%sT' ]

var getPeriod = function ( periods, date, isUTC ) {
    var l = periods.length - 1;
    var period = periods[l];
    while ( l-- ) {
        var candidate = periods[l];
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
    var l = rules.length;
    var year = datetime.getUTCFullYear();
    var ruleInEffect = null;
    var prevRule;
    var dateInEffect;
    while ( l-- ) {
        var rule = rules[l];
        // Sorted by end year. So if ends before this date, no further rules
        // can apply.
        if ( rule[1] < year ) {
            break;
        }
        // If starts on or before this date, the rule applies.
        if ( rule[0] <= year ) {
            // Create the date object representing the transition point.
            var month = rule[2];
            // 0 => last day of the month
            var date = rule[3] || Date.getDaysInMonth( month, year );
            var ruleDate = new Date(Date.UTC( year, month, date ));

            // Adjust to nearest +/- day of the week if specified
            var day = rule[4];
            if ( day ) {
                // +/- => (on or after/on or before) current date.
                // abs( value ) => 1=SUN,2=MON,... etc.
                var difference =
                    ( Math.abs( day ) - ruleDate.getUTCDay() + 6 ) % 7;
                if ( difference ) {
                    ruleDate.add(
                        day < 1 ? difference - 7 : difference
                    );
                }
            }

            // Set time (could be 24:00, which moves it to next day)
            ruleDate.setUTCHours( rule[5] );
            ruleDate.setUTCMinutes( rule[6] );
            ruleDate.setUTCSeconds( rule[7] );

            // Now match up timezones
            var ruleIsUTC = !rule[8];
            if ( ruleIsUTC !== isUTC ) {
                ruleDate.add(
                    ( ruleIsUTC ? 1 : -1 ) * offset, 'second'
                );
                // We need to add the offset of the previous rule. Sigh.
                // The maximum time offset from a rule is 2 hours. So if within
                // 3 hours, find the rule for the previous day.
                if ( rule[8] === 2 &&
                    Math.abs( ruleDate - datetime ) <= 3 * 60 * 60 * 1000 ) {
                    prevRule = getRule(
                        rules,
                        offset,
                        new Date( datetime - 86400000 ),
                        isUTC,
                        true
                    );
                    if ( prevRule ) {
                        ruleDate.add(
                            ( ruleIsUTC ? 1 : -1 ) * prevRule[9], 'second'
                        );
                    }
                }
            }

            // If we're converting from UTC, the time could be valid twice
            // or invalid. We should pick the rule to follow RFC5545 guidance:
            // Presume the earlier rule is still in effect in both cases
            if ( !isUTC ) {
                ruleDate.add( rule[9], 'second' );
                if ( Math.abs( ruleDate - datetime ) <= 3 * 60 * 60 * 1000 ) {
                    prevRule = prevRule || getRule(
                        rules,
                        offset,
                        new Date( datetime - 86400000 ),
                        isUTC,
                        true
                    );
                    if ( prevRule ) {
                        ruleDate.add( prevRule[9], 'second' );
                    }
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

var switchSign = function ( string ) {
    return string.replace( /[+-]/, function (sign) { return ( sign === '+' ? '-' : '+' ); } );
};

var TimeZone = Class({
    init: function init ( id, periods ) {
        var name = id.replace( /_/g, ' ' );
        // The IANA ids have the +/- the wrong way round for historical reasons.
        // Display correctly for the user.
        if ( /GMT[+-]/.test( name ) ) {
            name = switchSign( name );
        }

        this.id = id;
        this.name = name;
        this.periods = periods;
    },

    convert: function convert ( date, toTimeZone ) {
        var period = getPeriod( this.periods, date );
        var offset = period[1];
        var rule = getRule( TimeZone.rules[ period[2] ] || [],
            offset, date, toTimeZone, true );
        if ( rule ) {
            offset += rule[9];
        }
        if ( !toTimeZone ) {
            offset = -offset;
        }
        return new Date( +date + offset * 1000 );
    },
    convertDateToUTC: function convertDateToUTC ( date ) {
        return this.convert( date, false );
    },
    convertDateToTimeZone: function convertDateToTimeZone ( date ) {
        return this.convert( date, true );
    },
    getSuffix: function getSuffix ( date ) {
        var period = getPeriod( this.periods, date, false );
        var offset = period[1];
        var rule = getRule( TimeZone.rules[ period[2] ],
                offset, date, false, true );
        var suffix = period[3];
        var slashIndex = suffix.indexOf( '/' );
        // If there's a slash, e.g. "GMT/BST", presume first if no time offset,
        // second if time offset.
        if ( rule && slashIndex > - 1 ) {
            suffix = rule[9] ?
                suffix.slice( slashIndex + 1 ) : suffix.slice( 0, slashIndex );
            rule = null;
        }
        return suffix.format( rule ? rule[10] : '' );
    },
    toJSON: function toJSON () {
        return this.id;
    },
});

TimeZone.fromJSON = function ( id ) {
    return TimeZone[ id ] || null;
};

TimeZone.isEqual = function ( a, b ) {
    return a.id === b.id;
};

var addTimeZone = function ( timeZone ) {
    var area = TimeZone.areas;
    var parts = timeZone.name.split( '/' );
    var l = parts.length - 1;
    var i;
    for ( i = 0; i < l; i += 1 ) {
        area = area[ parts[i] ] || ( area[ parts[i] ] = {} );
    }
    area[ parts[l] ] = timeZone;

    TimeZone[ timeZone.id ] = timeZone;
};

TimeZone.rules = {
    '-': [],
};
TimeZone.areas = {};

TimeZone.load = function ( json ) {
    var zones = json.zones;
    var link = json.link;
    var alias = json.alias;

    for ( var id in zones ) {
        addTimeZone( new TimeZone( id, zones[ id ] ) );
    }
    for ( var id$1 in link ) {
        addTimeZone( new TimeZone(
            id$1,
            zones[ link[ id$1 ] ] || TimeZone[ link[ id$1 ] ].periods
        ));
    }
    for ( var id$2 in alias ) {
        TimeZone[ id$2 ] = TimeZone[ alias[ id$2 ] ];
    }
    Object.assign( TimeZone.rules, json.rules );
};

var HoldEvent = Class({

    Extends: Event,

    init: function init ( touch ) {
        HoldEvent.parent.constructor.call( this, 'hold', touch.target );
        this.touch = touch;
    },
});

var fireHoldEvent = function () {
    if ( !this._ignore ) {
        ViewEventsController.handleEvent(
            new HoldEvent( this.touch )
        );
    }
};

var TrackedTouch$1 = function ( touch ) {
    this.touch = touch;
    this.x = touch.screenX;
    this.y = touch.screenY;
    this.target = touch.target;
    this._ignore = false;
    RunLoop.invokeAfterDelay( fireHoldEvent, 750, this );
};

TrackedTouch$1.prototype.done = function () {
    this._ignore = true;
};

/*  A hold is defined as a touch which:

    * Lasts at least 750ms.
    * Moves less than 5px from the initial touch point.
*/
var Hold = new Gesture({

    _tracking: {},

    cancel: Tap.cancel,

    start: function start ( event ) {
        var touches = event.changedTouches;
        var tracking = this._tracking;
        var l = touches.length;
        for ( var i = 0; i < l; i += 1 ) {
            var touch = touches[i];
            var id = touch.identifier;
            if ( !tracking[ id ] ) {
                tracking[ id ] = new TrackedTouch$1( touch );
            }
        }
    },

    move: Tap.move,

    end: function end ( event ) {
        var touches = event.changedTouches;
        var tracking = this._tracking;
        var l = touches.length;
        for ( var i = 0; i < l; i += 1 ) {
            var touch = touches[i];
            var id = touch.identifier;
            var trackedTouch = tracking[ id ];
            if ( trackedTouch ) {
                trackedTouch.done();
                delete tracking[ id ];
            }
        }
    },
});

var ListItemView = Class({

    Extends: View,

    content: null,

    index: 0,
    itemHeight: 32,

    selection: null,
    isSelected: false,

    animateIn: false,

    init: function init ( mixin$$1 ) {
        var selection = mixin$$1.selection;
        var content = mixin$$1.content;
        if ( selection && content ) {
            this.isSelected = selection.isStoreKeySelected(
                content.get( 'storeKey' )
            );
        }
        ListItemView.parent.constructor.call( this, mixin$$1 );
    },

    positioning: 'absolute',

    layout: function () {
        var index = this.get( 'index' );
        var itemHeight = this.get( 'itemHeight' );
        var isNew = this.get( 'animateIn' ) && !this.get( 'isInDocument' );
        var y = ( index - ( isNew ? 1 : 0 ) ) * itemHeight;
        return {
            top: y,
            opacity: isNew ? 0 : 1,
        };
    }.property(),

    layoutWillChange: function () {
        this.computedPropertyDidChange( 'layout' );
    }.nextLoop().observes( 'index', 'itemHeight' ),

    resetLayout: function () {
        if ( this.get( 'animateIn' ) ) {
            this.computedPropertyDidChange( 'layout' );
        }
    }.nextLoop().observes( 'isInDocument' ),
});

var ListKBFocusView = Class({

    Extends: View,

    selection: null,
    singleSelection: null,

    index: bind( 'singleSelection*index' ),
    record: bind( 'singleSelection*record' ),

    itemHeight: 32,

    keys: {
        j: 'goNext',
        k: 'goPrev',
        x: 'select',
        X: 'select',
        o: 'trigger',
        Enter: 'trigger',
        s: 'star',
    },

    className: 'v-ListKBFocus',

    positioning: 'absolute',

    layoutIndex: function () {
        var index = this.get( 'index' );
        var list = this.get( 'singleSelection' ).get( 'content' );
        if ( index > -1 && list &&
                list.getObjectAt( index ) !== this.get( 'record' ) ) {
            return -1;
        }
        return index;
    }.property( 'index', 'record' ),

    layout: function () {
        var itemHeight = this.get( 'itemHeight' );
        var index = this.get( 'layoutIndex' );
        return {
            visibility: index < 0 ? 'hidden' : 'visible',
            top: index < 0 ? 0 : itemHeight * index,
            height: itemHeight,
        };
    }.property( 'itemHeight', 'layoutIndex' ),

    didEnterDocument: function didEnterDocument () {
        var this$1 = this;

        var keys = this.get( 'keys' );
        var shortcuts = ViewEventsController.kbShortcuts;
        for ( var key in keys ) {
            shortcuts.register( key, this$1, keys[ key ] );
        }
        this.checkInitialScroll();
        return ListKBFocusView.parent.didEnterDocument.call( this );
    },
    willLeaveDocument: function willLeaveDocument () {
        var this$1 = this;

        var keys = this.get( 'keys' );
        var shortcuts = ViewEventsController.kbShortcuts;
        for ( var key in keys ) {
            shortcuts.deregister( key, this$1, keys[ key ] );
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
    }.queue( 'after' ).observes( 'record' ),

    distanceFromVisRect: function () {
        var layoutIndex = this.get( 'layoutIndex' );
        var scrollView = this.getParent( ScrollView );
        if ( scrollView && layoutIndex > -1 &&
                this.get( 'isInDocument' ) && !this._needsRedraw ) {
            var scrollTop = scrollView.get( 'scrollTop' );
            var position = this.getPositionRelativeTo( scrollView );
            var top = position.top;
            var above = top - scrollTop;

            if ( above < 0 ) {
                return above;
            }

            var scrollHeight = scrollView.get( 'pxHeight' );
            var below = top + this.get( 'pxHeight' ) -
                scrollTop - scrollHeight;

            if ( below > 0 ) {
                return below;
            }
        }
        return 0;
    }.property().nocache(),

    scrollIntoView: function scrollIntoView ( offset, withAnimation ) {
        var scrollView = this.getParent( ScrollView );
        if ( scrollView ) {
            var scrollHeight = scrollView.get( 'pxHeight' );
            var itemHeight = this.get( 'pxHeight' );
            var top = this.getPositionRelativeTo( scrollView ).top;

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

    go: function go ( delta ) {
        var index = this.get( 'index' );
        var singleSelection = this.get( 'singleSelection' );
        var list = singleSelection.get( 'content' );
        var length = list && list.get( 'length' ) || 0;
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
    },
    goNext: function goNext () {
        this.go( 1 );
    },
    goPrev: function goPrev () {
        this.go( -1 );
    },
    select: function select ( event ) {
        var index = this.get( 'index' );
        var selection = this.get( 'selection' );
        var record = this.get( 'record' );
        // Check it's next to a loaded record.
        if ( selection && record ) {
            selection.selectIndex( index,
                !selection.isStoreKeySelected( record.get( 'storeKey' ) ),
                event.shiftKey );
        }
    },
    trigger: function trigger () {},
    star: function star () {},
});

/**
    Mixin: O.TrueVisibleRect

    The TrueVisibleRect mixin can be added to view classes to make the
    <O.View#visibleRect> property take into account clipping by the parent view.
    This is more expensive, so should only be used in classes where this is
    absolutely necessary, for example in <O.ProgressiveListView>, where it is
    used to only render the visible portion of a potentially very long list.
*/
var TrueVisibleRect = {

    visibleRect: function () {
        // Ignore any changes whilst not in the DOM
        if ( !this.get( 'isInDocument' ) ) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        // Calculate current visible rect.
        var x = this.get( 'pxLeft' );
        var y = this.get( 'pxTop' );
        var width = this.get( 'pxWidth' );
        var height = this.get( 'pxHeight' );
        var parent = this.get( 'parentView' ).get( 'visibleRect' );

        var left = Math.max( x, parent.x );
        var right = Math.min( x + width, parent.x + parent.width );
        var top = Math.max( y, parent.y );
        var bottom = Math.min( y + height, parent.y + parent.height );
        var across = Math.max( right - left, 0 );
        var down = Math.max( bottom - top, 0 );

        return {
            x: left - x + this.get( 'scrollLeft' ),
            y: top - y + this.get( 'scrollTop' ),
            width: across,
            height: down,
        };
    }.property( 'scrollTop', 'scrollLeft',
        'pxLayout', 'parentView.visibleRect', 'isInDocument' ),
};

var ProgressiveListView = Class({

    Extends: ListView,

    Mixin: TrueVisibleRect,

    batchSize: 10,
    triggerInPx: 200,

    init: function init (/* ...mixins */) {
        ProgressiveListView.parent.constructor.apply( this, arguments );
        this.firstVisible = 0;
        this.lastVisible = 0;
        this._renderRange.end = 0;
    },

    contentWasUpdated: function contentWasUpdated ( event ) {
        var scrollView = this.getParent( ScrollView );
        if ( scrollView ) {
            // Update scroll view correctly.
            var itemHeight = this.get( 'itemHeight' );
            var y = Math.max( this.get( 'visibleRect' ).y, 0 );
            // Index of first item rendered
            var top = ~~( y / itemHeight );
            var removedIndexes = event.removedIndexes;
            var addedIndexes = event.addedIndexes;
            var rendered = this._rendered;
            var change = 0;
            var i, l, id, view;

            // If we are within 3 items of the top, don't change anything.
            // The new items will push down the old so you will see the change.
            // Otherwise, adjust the scroll to make it appear as though it
            // hasn't changed when the new items are inserted above, so a flood
            // of items doesn't stop you from viewing a section of the list.
            if ( top > 2 ) {
                for ( i = 0, l = removedIndexes.length; i < l; i += 1 ) {
                    if ( removedIndexes[i] < top ) {
                        change -= 1;
                    } else {
                        // Guaranteed in ascending order.
                        break;
                    }
                }
                top += change;
                for ( i = 0, l = addedIndexes.length; i < l; i += 1 ) {
                    if ( addedIndexes[i] <= top ) {
                        change += 1;
                    } else {
                        // Guaranteed in ascending order.
                        break;
                    }
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
        if ( !this.get( 'isInDocument' ) ) {
            return;
        }
        // Convert null/undefined length to 0.
        if ( !length ) {
            length = 0;
        }
        // In IE or Opera, if the scrollTop of the containing overflowed div was
        // past the new maximum scrollTop, then although it correctly changes
        // to the new maximum scrollTop, no scroll event is fired. Therefore we
        // have to simulate this firing in the next event loop.
        if ( length < oldLength ) {
            RunLoop.invokeInNextEventLoop(
                this.fire.bind( this, 'scroll', null, null )
            );
        }
    }.observes( 'contentLength' ),

    visibleRectDidChange: function () {
        // We only care about changes when we're visible.
        if ( this.get( 'isInDocument' ) ) {
            var visible = this.get( 'visibleRect' );
            var extension = this.get( 'triggerInPx' );
            var batchSize = this.get( 'batchSize' );
            var itemHeight = this.get( 'itemHeight' );
            var batchHeight = itemHeight * batchSize;
            var y = visible.y;
            var height = visible.height;
            // Index of first item we want rendered
            var start = Math.max( 0,
                    ~~( ( y - extension ) / batchHeight ) * batchSize );
            // Index of last item we want rendered
            var end = ~~( ( y + height + extension ) / batchHeight ) *
                    batchSize + batchSize;
            var _renderRange = this._renderRange;

            this.set( 'firstVisible', Math.floor( y / itemHeight ) )
                .set( 'lastVisible',
                    Math.floor( ( y + height ) / itemHeight ) + 1 );

            if ( start !== _renderRange.start || end !== _renderRange.end ) {
                _renderRange.start = start;
                _renderRange.end = end;
                this.viewNeedsRedraw();
            }
        }
    }.queue( 'middle' ).observes( 'visibleRect', 'itemHeight' ),
});

/*global document */

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

var SwitchView = Class({

    Extends: View,

    syncOnlyInDocument: false,

    init: function init (/* ...mixins */) {
        this._oldView = null;
        // -1 => Not added views to parent
        // Otherwise => Index of view(s) currently in parent
        this._index = -1;

        // Index of view that should be in parent.
        this.index = 0;
        this.views = [];
        this.subViews = [];

        SwitchView.parent.constructor.apply( this, arguments );

        this.isRendered = true;

        var views = this.get( 'views' );
        var l = views.length;
        var view;
        while ( l-- ) {
            view = views[l];
            if ( view && !( view instanceof Array ) ) {
                views[l] = [ view ];
            }
        }
    },

    destroy: function destroy () {
        var views = this.get( 'views' );
        var l = views.length;
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

    willEnterDocument: function willEnterDocument () {
        this.resume();
        this.redraw();
        return this;
    },

    didEnterDocument: function didEnterDocument () {
        this.set( 'isInDocument', true );
        if ( this.get( 'index' ) !== this._index ) {
            this.switchNeedsRedraw();
        }
        return this;
    },

    willLeaveDocument: function willLeaveDocument () {
        return this.set( 'isInDocument', false );
    },

    didLeaveDocument: function didLeaveDocument () {
        return this.suspend();
    },

    // ---

    redraw: function redraw () {
        var oldIndex = this._index;
        var newIndex = this.get( 'index' );
        // If not yet added to parent, nothing to redraw; _add will be called
        // automatically soon.
        if ( !this.isDestroyed && oldIndex > -1 && oldIndex !== newIndex ) {
            if ( this._suspendRedraw ) {
                this._needsRedraw = [];
            } else {
                this._needsRedraw = null;
                var parentView = this.get( 'parentView' );
                if ( parentView ) {
                    this._remove( parentView );
                    this._add();
                }
            }
        }
    },

    switchNeedsRedraw: function () {
        if ( this.get( 'isInDocument' ) ) {
            if ( this._suspendRedraw ) {
                this._needsRedraw = [];
            } else {
                RunLoop.queueFn( 'render', this.redraw, this );
            }
        }
    }.observes( 'index' ),

    parentViewDidChange: function ( _, __, oldParent, newParent ) {
        if ( oldParent ) {
            // May be a NOP, but just in case.
            oldParent.removeObserverForKey( 'childViews', this, '_add' );
            this._remove( oldParent );
        }
        if ( newParent ) {
            if ( newParent.get( 'childViews' ).contains( this ) ) {
                // If we already know where we are in the parent view, we can
                // add our real views immediately.
                this._add();
            } else {
                // Otherwise, we need to wait until we've been inserted to know
                // where our DOM marker has been placed, and where the view is
                // in the list of child views.
                newParent.addObserverForKey( 'childViews', this, '_add' );
            }
        }
    }.observes( 'parentView' ),

    _add: function _add () {
        var this$1 = this;

        var index = this.get( 'index' );
        var views = this.get( 'views' )[ index ];
        var subViews = this.get( 'subViews' )[ index ];
        var parent = this.get( 'parentView' );
        var isInDocument = parent.get( 'isInDocument' );
        var position = this.get( 'layer' );
        var layer = position.parentNode;
        var l, node, before;

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
                parent.insertView( node, this$1, 'after' );
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

    _remove: function _remove ( parent ) {
        var oldIndex = this._index;
        var views = this.get( 'views' )[ oldIndex ];
        var subViews = this.get( 'subViews' )[ oldIndex ];
        var isInDocument = parent.get( 'isInDocument' );
        var l, node, childViews, view, index, numToRemove;

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
    insertView: function insertView ( view, parentNode ) {
        this.childViews.push( view );
        var oldParent = view.get( 'parentView' );
        if ( oldParent ) {
            oldParent.removeView( view );
        }
        parentNode.appendChild( view.render().get( 'layer' ) );
        return this;
    },

    _addCondition: function _addCondition ( view, index ) {
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

    show: function show ( view ) {
        return this._addCondition( view, 0 );
    },

    otherwise: function otherwise ( view ) {
        return this._addCondition( view, 1 );
    },

    end: function end () {
        Element$1.forView( this._oldView );
        this._oldView = null;
        return this;
    },
});

var pickViewWhen = function ( bool ) {
    return bool ? 0 : 1;
};
var pickViewUnless = function ( bool ) {
    return bool ? 1 : 0;
};

var createView = function ( object, property, transform ) {
    var switchView = new SwitchView({
        index: bind( object, property, transform ),
    });
    switchView._oldView = Element$1.forView( switchView );
    return switchView;
};

Element$1.when = function ( object, property, transform ) {
    var pickView = transform ? function ( value, syncForward ) {
        return pickViewWhen( transform( value, syncForward ) );
    } : pickViewWhen;
    return createView( object, property, pickView );
};
Element$1.unless = function ( object, property, transform ) {
    var pickView = transform ? function ( value, syncForward ) {
        return pickViewUnless( transform( value, syncForward ) );
    } : pickViewUnless;
    return createView( object, property, pickView );
};

var VERTICAL$1 = 1;
var HORIZONTAL = 2;
var TOP_LEFT$1 = 4;
var BOTTOM_RIGHT = 8;

var auto = 'auto';

/**
    Class: O.SplitViewController

    Extends: O.Object
*/
var SplitViewController = Class({

    Extends: Obj,

    /**
        Property: O.SplitViewController#direction
        Type: Number
        Default: O.SplitViewController.VERTICAL

        The direction to split the view, either `O.SplitViewController.VERTICAL`
        (the default) or `O.SplitViewController.HORIZONTAL`.
    */
    direction: VERTICAL$1,

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
    flex: TOP_LEFT$1,

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
        var flexDir = this.get( 'direction' );
        var flexPane = this.get( 'flex' );
        var staticLength = this.get( 'staticPaneLength' );
        return layout || {
            top: 0,
            left: 0,
            right: ( flexDir === VERTICAL$1 &&
                flexPane === TOP_LEFT$1 ) ? staticLength : auto,
            width: flexDir === HORIZONTAL ? '100%' :
                flexPane === TOP_LEFT$1 ? auto : staticLength,
            bottom: ( flexDir === HORIZONTAL &&
                flexPane === TOP_LEFT$1 ) ? staticLength : auto,
            height: flexDir === VERTICAL$1 ? '100%' :
                flexPane === TOP_LEFT$1 ? auto : staticLength,
        };
    }.property( 'flex', 'direction', 'staticPaneLength' ),

    /**
        Property: O.SplitViewController#bottomRightLayout
        Type: Object

        The layout properties to use to position the bottom/right pane.
    */
    bottomRightLayout: function ( layout ) {
        var flexDir = this.get( 'direction' );
        var flexPane = this.get( 'flex' );
        var staticLength = this.get( 'staticPaneLength' );
        return layout || {
            bottom: 0,
            right: 0,
            left: ( flexDir === VERTICAL$1 &&
                flexPane === BOTTOM_RIGHT ) ? staticLength : auto,
            width: flexDir === HORIZONTAL ? '100%' :
                flexPane === BOTTOM_RIGHT ? auto : staticLength,
            top: ( flexDir === HORIZONTAL &&
                flexPane === BOTTOM_RIGHT ) ? staticLength : auto,
            height: flexDir === VERTICAL$1 ? '100%' :
                flexPane === BOTTOM_RIGHT ? auto : staticLength,
        };
    }.property( 'flex', 'direction', 'staticPaneLength' ),
});

SplitViewController.VERTICAL = VERTICAL$1;
SplitViewController.HORIZONTAL = HORIZONTAL;
SplitViewController.TOP_LEFT = TOP_LEFT$1;
SplitViewController.BOTTOM_RIGHT = BOTTOM_RIGHT;

var VERTICAL = SplitViewController.VERTICAL;
var TOP_LEFT = SplitViewController.TOP_LEFT;

/**
    Class: O.SplitDividerView

    Extends: O.View

    Includes: O.Draggable

    An O.SplitDividerView instance represents the divide between two panes
    controllered by an <O.SplitViewController> instance. It can be dragged to
    resize the static pane in the split view.
*/
var SplitDividerView = Class({

    Extends: View,

    Mixin: Draggable,

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
    offset: bindTwoWay( 'controller.staticPaneLength' ),

    /**
        Property: O.SplitDividerView#min
        Type: Number

        Bound to the <O.SplitViewController#minStaticPaneLength>.
    */
    min: bind( 'controller.minStaticPaneLength' ),

    /**
        Property: O.SplitDividerView#max
        Type: Number

        Bound to the <O.SplitViewController#maxStaticPaneLength>.
    */
    max: bind( 'controller.maxStaticPaneLength' ),

    /**
        Property: O.SplitDividerView#direction
        Type: Number

        Bound to the <O.SplitViewController#direction>.
    */
    direction: bind( 'controller.direction' ),

    /**
        Property: O.SplitDividerView#flex
        Type: Number

        Bound to the <O.SplitViewController#flex>.
    */
    flex: bind( 'controller.flex' ),

    /**
        Property: O.SplitDividerView#anchor
        Type: String

        The CSS property giving the side the <O.SplitDividerView#offset> is from
        (top/left/bottom/right).
    */
    anchor: function () {
        var flexTL = this.get( 'flex' ) === TOP_LEFT;
        var isVertical = this.get( 'direction' ) === VERTICAL;
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
        var thickness = this.get( 'thickness' );
        var styles;
        if ( this.get( 'direction' ) === VERTICAL ) {
            styles = {
                top: 0,
                bottom: 0,
                width: thickness,
            };
        } else {
            styles = {
                left: 0,
                right: 0,
                height: thickness,
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
    dragStarted: function dragStarted () {
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
    dragMoved: function dragMoved ( drag ) {
        var dir = this._dir;
        var delta = drag.get( 'cursorPosition' )[ dir ] -
            drag.get( 'startPosition' )[ dir ];
        var sign = this.get( 'flex' ) === TOP_LEFT ? -1 : 1;

        this.set( 'offset',
            ( this._offset + ( sign * delta ) )
                .limit( this.get( 'min' ), this.get( 'max' ) )
        );
    },
});

/**
    Class: O.CheckboxView

    Extends: O.AbstractControlView

    A checkbox control view. The `value` property is two-way bindable,
    representing the state of the checkbox (`true` => checked).
*/
var CheckboxView = Class({

    Extends: AbstractControlView,

    // --- Render ---

    type: '',

    isIndeterminate: false,

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
    draw: function draw ( layer, Element, el ) {
        return [
            this._domControl = el( 'input', {
                className: 'v-Checkbox-input',
                type: 'checkbox',
                checked: this.get( 'value' ),
                indeterminate: this.get( 'isIndeterminate' ),
            }),
            CheckboxView.parent.draw.call( this, layer, Element, el ) ];
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.CheckboxView#checkboxNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    checkboxNeedsRedraw: function ( self, property, oldValue ) {
        return this.propertyNeedsRedraw( self, property, oldValue );
    }.observes( 'value', 'isIndeterminate' ),

    /**
        Method: O.CheckboxView#redrawValue

        Updates the checked status of the DOM `<input type="checkbox">` to match
        the value property of the view.
    */
    redrawValue: function redrawValue () {
        this._domControl.checked = this.get( 'value' );
    },

    redrawIsIndeterminate: function redrawIsIndeterminate () {
        this._domControl.indeterminate = this.get( 'isIndeterminate' );
    },

    // --- Activate ---

    /**
        Method: O.CheckboxView#activate

        Overridden to toggle the checked status of the control. See
        <O.AbstractControlView#activate>.
    */
    activate: function activate () {
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
            var control = this._domControl;
            var value = control.checked;
            if ( isTap || event.target !== control ) {
                event.preventDefault();
                value = !value;
            }
            this.set( 'value', value );
        }
    }.on( 'click', 'tap' ),
});

/**
    Class: O.LabelView

    Extends: O.View

    A LabelView simply displays a string of text, and optionally has a tooltip.
    Its DOM structure is:

        <span title="${view.tooltip}">${view.value}</span>

    Although you may often want to change the layer tag (e.g. to an `h1` etc.)
*/
var LabelView = Class({

    Extends: View,

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
    draw: function draw ( layer/*, Element, el*/ ) {
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
    redrawTooltip: function redrawTooltip ( layer ) {
        layer.title = this.get( 'tooltip' );
    },

    /**
        Method: O.LabelView#redrawValue

        Parameters:
            layer - {Element} The DOM layer for the view.

        Updates the text content of the DOM layer to match the value property of
        the view.
    */
    redrawValue: function redrawValue ( layer ) {
        layer.textContent = this.get( 'value' );
    },
});

/**
    Class: O.RadioView

    Extends: O.AbstractControlView

    A radio-button control view. The `value` property is two-way bindable,
    representing the state of the button (`true` => selected).
*/
var RadioView = Class({

    Extends: AbstractControlView,

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
    draw: function draw ( layer, Element, el ) {
        return [
            this._domControl = el( 'input', {
                className: 'v-Radio-input',
                type: 'radio',
                checked: this.get( 'value' ),
            }),
            RadioView.parent.draw.call( this, layer, Element, el ) ];
    },

    // --- Keep render in sync with state ---

    /**
        Method: O.RadioView#radioNeedsRedraw

        Calls <O.View#propertyNeedsRedraw> for extra properties requiring
        redraw.
    */
    radioNeedsRedraw: CheckboxView.prototype.checkboxNeedsRedraw,

    /**
        Method: O.RadioView#redrawValue

        Updates the checked status of the DOM `<input type="radio">` to match
        the value property of the view.
    */
    redrawValue: CheckboxView.prototype.redrawValue,

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
    }.on( 'click' ),
});

/**
    Class: O.SelectView

    Extends: O.AbstractControlView

    A view representing an HTML `<select>` menu. The `value` property is two-way
    bindable, representing the selected option.
*/
var SelectView = Class({

    Extends: AbstractControlView,

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
            ( this.get( 'isFocused' ) ? ' is-focused' : '' ) +
            ( this.get( 'isDisabled' ) ? ' is-disabled' : '' ) +
            ( type ? ' ' + type : '' );
    }.property( 'type', 'isFocused', 'isDisabled' ),

    /**
        Method: O.SelectView#draw

        Overridden to draw select menu in layer. See <O.View#draw>.
    */
    draw: function draw ( layer, Element, el ) {
        var control = this._domControl =
            this._drawSelect( this.get( 'options' ) );
        return [
            SelectView.parent.draw.call( this, layer, Element, el ),
            control ];
    },

    /**
        Method (private): O.SelectView#_drawSelect

        Creates the DOM elements for the `<select>` and all `<option>` children.

        Parameters:
            options - {Array} Array of option objects.

        Returns:
            {Element} The `<select>`.
    */
    _drawSelect: function _drawSelect ( options ) {
        var selected = this.get( 'value' );
        var el = Element$1.create;
        var select = el( 'select', {
                className: 'v-Select-input',
                disabled: this.get( 'isDisabled' ),
            },
                options.map(
                    function ( option, i ) { return el( 'option', {
                        text: option.text,
                        value: i,
                        selected: isEqual( option.value, selected ),
                        disabled: !!option.isDisabled,
                    }); }
                )
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
    redrawOptions: function redrawOptions ( layer, oldOptions ) {
        var options = this.get( 'options' );
        if ( !isEqual( options, oldOptions ) ) {
            // Must blur before removing from DOM in iOS, otherwise
            // the slot-machine selector will not hide
            var isFocused = this.get( 'isFocused' );
            var select = this._drawSelect( options );
            if ( isFocused ) {
                this.blur();
            }
            layer.replaceChild( select, this._domControl );
            this._domControl = select;
            if ( isFocused ) {
                this.focus();
            }
        }
    },

    /**
        Method: O.SelectView#redrawValue

        Selects the corresponding option in the select when the
        <O.SelectView#value> property changes.
    */
    redrawValue: function redrawValue () {
        var this$1 = this;

        var value = this.get( 'value' );
        var options = this.get( 'options' );
        var l = options.length;

        while ( l-- ) {
            if ( isEqual( options[l].value, value ) ) {
                this$1._domControl.value = l + '';
                return;
            }
        }
        // Work around Chrome on Android bug where it doesn't redraw the
        // select control until the element blurs.
        if ( this.get( 'isFocused' ) ) {
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
    }.on( 'change' ),
});

/* eslint-disable max-len */

/*
    NOTE(circular-imports): there are several circular imports in the Overture
    codebase still. Provided the circular references don’t get hit immediately
    (that is, provided the circularly-referenced names are only used inside
    functions which are not invoked until after all of the loop has been
    loaded), this is very mildly undesirable, but OK. (Such imports should be
    marked by a comment as circular but OK.)

    HOWEVER, in places where the name is used in the code executed immediately
    (e.g. as a superclass for a class constructed in the module root), we have a
    problem. The referred-to name must *not* be imported first: something else
    from the circular import loop must be instead. For now, we can work around
    this by ordering our imports carefully in this file, but it’s not good
    enough; we desire to be able to import anything from Overture directly, thus
    enabling further dead-code removal.

    To list circular imports, install madge (from npm) and run this command:

        madge source/Overture --circular

    If it does not list exactly the five below, we’re in trouble and you’ll have
    to assess it all over again.

    Safe cycles that exist:

    - drag-drop/{Drag ↔ DragController}: not used in the global scope

    - dom/Element ↔ views/View: not used in the global scope

    Bad cycles that exist and are dependent on import order (marked elsewhere in
    this file by FIXME notes):

    - core/Date → localisation/LocaleController → localisation/Locale →
      core/Date: LocaleController uses Locale in the global scope
*/

// Replace the global Promise with our RunLoop-enabled Promise
self.Promise = OPromise;

exports.Promise = OPromise;
exports.Status = Status;
exports.DOMEvent = DOMEvent;
exports.DragEffect = DragEffect;
exports.sortByProperties = sortByProperties;
exports.BoundProps = BoundProps;
exports.ComputedProps = ComputedProps;
exports.Enumerable = Enumerable;
exports.Event = Event;
exports.EventTarget = EventTarget;
exports.getFromPath = getFromPath;
exports.Heap = Heap;
exports.MutableEnumerable = MutableEnumerable;
exports.Object = Obj;
exports.ObservableArray = ObservableArray;
exports.ObservableProps = ObservableProps;
exports.ObservableRange = ObservableRange;
exports.RunLoop = RunLoop;
exports.Transform = Transform;
exports.AnimatableView = AnimatableView;
exports.Animation = Animation;
exports.Easing = Easing;
exports.StyleAnimation = StyleAnimation;
exports.formatKeyForPlatform = formatKeyForPlatform;
exports.GlobalKeyboardShortcuts = GlobalKeyboardShortcuts;
exports.Router = Router;
exports.ThemeManager = ThemeManager;
exports.WindowController = WindowController;
exports.RecordArray = RecordArray;
exports.Query = Query;
exports.LocalQuery = LocalQuery;
exports.WindowedQuery = WindowedQuery;
exports.AttributeErrors = AttributeErrors;
exports.Record = Record;
exports.RecordAttribute = RecordAttribute;
exports.ToManyAttribute = ToManyAttribute;
exports.ToOneAttribute = ToOneAttribute;
exports.RecordResult = RecordResult;
exports.ValidationError = ValidationError;
exports.AggregateSource = AggregateSource;
exports.Source = Source;
exports.MemoryManager = MemoryManager;
exports.NestedStore = NestedStore;
exports.Store = Store;
exports.StoreUndoManager = StoreUndoManager;
exports.UndoManager = UndoManager;
exports.Element = Element$1;
exports.Stylesheet = Stylesheet;
exports.Drag = Drag;
exports.DragController = DragController;
exports.DragDataSource = DragDataSource;
exports.Draggable = Draggable;
exports.DropTarget = DropTarget;
exports.EventSource = EventSource;
exports.HttpRequest = HttpRequest;
exports.IOQueue = IOQueue;
exports.XHR = XHR;
exports.Locale = Locale;
exports.parse = DateParser;
exports.Parse = Parse;
exports.OptionsController = OptionsController;
exports.SelectionController = SelectionController;
exports.SingleSelectionController = SingleSelectionController;
exports.LocalStorage = LocalStorage;
exports.TimeZone = TimeZone;
exports.Gesture = Gesture;
exports.GestureManager = GestureManager;
exports.Hold = Hold;
exports.Tap = Tap;
exports.UA = UA;
exports.RootView = RootView;
exports.View = View;
exports.activeViews = activeViews;
exports.getViewFromNode = getViewFromNode;
exports.ViewEventsController = ViewEventsController;
exports.ListItemView = ListItemView;
exports.ListKBFocusView = ListKBFocusView;
exports.ListView = ListView;
exports.ProgressiveListView = ProgressiveListView;
exports.OptionsListView = OptionsListView;
exports.SwitchView = SwitchView;
exports.ToolbarView = ToolbarView;
exports.TrueVisibleRect = TrueVisibleRect;
exports.ScrollView = ScrollView;
exports.SplitDividerView = SplitDividerView;
exports.SplitViewController = SplitViewController;
exports.AbstractControlView = AbstractControlView;
exports.ButtonView = ButtonView;
exports.CheckboxView = CheckboxView;
exports.ClearSearchButtonView = ClearSearchButtonView;
exports.FileButtonView = FileButtonView;
exports.LabelView = LabelView;
exports.MenuOptionView = MenuOptionView;
exports.MenuFilterView = MenuFilterView;
exports.MenuButtonView = MenuButtonView;
exports.MenuView = MenuView;
exports.RadioView = RadioView;
exports.RichTextView = RichTextView;
exports.SearchTextView = SearchTextView;
exports.SelectView = SelectView;
exports.TextView = TextView;
exports.ModalEventHandler = ModalEventHandler;
exports.PopOverView = PopOverView;
exports.meta = meta;
exports.guid = guid;
exports.mixin = mixin;
exports.extend = extend;
exports.merge = merge;
exports.clone = clone;
exports.isEqual = isEqual;
exports.Class = Class;
exports.Binding = Binding;
exports.bind = bind;
exports.bindTwoWay = bindTwoWay;
exports.LocaleController = LocaleController;
exports.i18n = LocaleController;
exports.loc = loc;

}((this.O = this.O || {})));
