// -------------------------------------------------------------------------- \\
// File: drawHTML.js                                                          \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, App, DOMPurify, document */

( function () {

// --- CSS Sanitiser ---

var counter = 0;
var id = '';

var addToSet = function (set, array) {
    var l = array.length;
    while (l--) {
        set[array[l]] = true;
    }
    return set;
};
var ALLOWED_CSS_PROPERTY = addToSet( {}, [
    // Background
    'background',
    'background-',
    // e.g.
    // 'background-attachment',
    // 'background-clip',
    // 'background-color',
    // 'background-image',
    // 'background-origin',
    // 'background-position',
    // 'background-position-x',
    // 'background-position-y',
    // 'background-repeat',
    // 'background-repeat-x',
    // 'background-repeat-y',
    // 'background-size',

    // Border
    'border',
    'border-',
    // e.g.
    // 'border-bottom',
    // 'border-bottom-color',
    // 'border-bottom-left-radius',
    // 'border-bottom-right-radius',
    // 'border-bottom-style',
    // 'border-bottom-width',
    // 'border-collapse',
    // 'border-color',
    // 'border-image',
    // 'border-image-outset',
    // 'border-image-repeat',
    // 'border-image-slice',
    // 'border-image-source',
    // 'border-image-width',
    // 'border-left',
    // 'border-left-color',
    // 'border-left-style',
    // 'border-left-width',
    // 'border-radius',
    // 'border-right',
    // 'border-right-color',
    // 'border-right-style',
    // 'border-right-width',
    // 'border-spacing',
    // 'border-style',
    // 'border-top',
    // 'border-top-color',
    // 'border-top-left-radius',
    // 'border-top-right-radius',
    // 'border-top-style',
    // 'border-top-width',
    // 'border-width',

    // Outline
    'outline',
    'outline-',
    // e.g.
    // 'outline-width',
    // 'outline-style',
    // 'outline-color',
    // 'outline-offset',

    // Margins and padding
    'margin',
    'margin-',
    // e.g.
    // 'margin-top',
    // 'margin-right',
    // 'margin-bottom',
    // 'margin-left',
    'padding',
    'padding-',
    // e.g.
    // 'padding-top',
    // 'padding-right',
    // 'padding-bottom',
    // 'padding-left',

    // Lists
    'list-style',
    'list-style-type',
    'list-style-image',
    'list-style-position',

    // Font
    'font',
    'font-',
    // e.g.
    // 'font-family',
    // 'font-style',
    // 'font-variant',
    // 'font-weight',
    // 'font-size',

    // Colour
    'color',
    'opacity',

    // Text formatting
    'direction',
    'letter-spacing',
    'line-break',
    'line-height',
    'overflow-wrap',
    'text-',
    // e.g.
    // 'text-align',
    // 'text-decoration',
    // 'text-indent',
    // 'text-overflow',
    // 'text-transform',
    'vertical-align',
    'white-space',
    'word-spacing',
    'word-wrap',
    'word-break',

    // Layout
    'display',
    'position',
    'visibility',
    'overflow',
    'overflow-x',
    'overflow-y',
    'z-index',
    'zoom',
    'top',
    'right',
    'bottom',
    'left',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'float',
    'clear',
    'clip',
    'clip-path',
    /*'cursor',*/
    'object-fit',
    'object-position',

    // Tables
    'border-collapse',
    'border-spacing',
    'caption-side',
    'empty-cells',
    'table-layout',

    // Quotes
    'content',
    /*'counter-increment',*/
    /*'counter-reset',*/
    'quotes',

    // Printing
    'orphans',
    'page-break-after',
    'page-break-before',
    'page-break-inside',
    'widows',

    // Shadows
    'box-shadow',
    'text-shadow',

    // Animation
    'animation',
    'animation-',
    // e.g.
    // 'animation-delay',
    // 'animation-direction',
    // 'animation-duration',
    // 'animation-fill-mode',
    // 'animation-iteration-count',
    // 'animation-name',
    // 'animation-play-state',
    // 'animation-timing-function',

    // Transform
    'transform',
    'transform-origin',
    'transform-style',
    'perspective',
    'perspective-origin',

    // Transition
    'transition',
    'transition-',
    // e.g.
    // 'transition-delay',
    // 'transition-duration',
    // 'transition-property',
    // 'transition-timing-function',

    // Flexbox
    'align-',
    // e.g.
    // 'align-content',
    // 'align-items',
    // 'align-self',
    'flex',
    'flex-',
    // e.g.
    // 'flex-basis',
    // 'flex-direction',
    // 'flex-flow',
    // 'flex-grow',
    // 'flex-shrink',
    // 'flex-wrap',
    'justify-content',
    'order',

    // Columns
    'columns',
    'column-',
    // e.g.
    // 'column-count',
    // 'column-fill',
    // 'column-gap',
    // 'column-rule',
    // 'column-rule-color',
    // 'column-rule-style',
    // 'column-rule-width',
    // 'column-span',
    // 'column-width'
]);

var sanitiseSelector = function ( selector ) {
    // For each selector (comma separated)...
    return selector.split( ',' ).map( function ( selector ) {
        // If it starts with an html/body element match, just slice it off
        // We'll be putting a root tag first anyway
        if ( /^(?:html|body)(?!\w)/.test( selector ) ) {
            selector = selector.slice( 4 );
        }
        // Prefix with root id to narrow scope and rewrite classes and ids.
        return '#' + id + ' ' + selector.replace(
            /([#.]|\[\s*(?:id|class|for)\s*[~|^]?=\s*["'])/gi,
            '$1' + id + '-'
        );
    }).join( ',' );
};

var sanitiseStyle = function ( style ) {
    var output = '';
    var i, l, name, value, important, nonPrefixName;
    for ( i = 0, l = style.length; i < l; i += 1 ) {
        name = style[i];
        // For Firefox: some properties (e.g. padding-left), it splits into 3:
        // padding-left-value, padding-left-rtl-source, padding-left-ltr-source.
        // But none of these are actually properties on the style object! You
        // have to use padding-left to get the style.
        if ( /-value$/.test( name ) ) {
            name = name.slice( 0, -6 );
        }
        // For Safari: splits background-repeat into 2 (background-repeat-x/
        // background-repeat-y) in CSSOM, but does not accept these to set in
        // style attribute CSS text.
        if ( /background-repeat-/.test( name ) ) {
            name = 'background-repeat';
        }
        value = style.getPropertyValue( name );
        important = style.getPropertyPriority( name );
        nonPrefixName = name.charAt( 0 ) === '-' ?
            name.slice( name.indexOf( '-', 1 ) + 1 ) : name;
        if ( value && ( ALLOWED_CSS_PROPERTY[ nonPrefixName ] ||
                // Allow all border-* etc. properties
                ALLOWED_CSS_PROPERTY[
                    nonPrefixName.slice( 0, nonPrefixName.indexOf( '-' ) + 1 )
                ])) {
            // Whitelist allowed position values
            if ( name === 'position' ) {
                if ( value === 'fixed' ) {
                    value = 'absolute';
                }
                if ( !/^(?:absolute|relative|static)$/.test( value ) ) {
                    continue;
                }
            }
            // Write out the style
            output += name;
            output += ':';
            output += value;
            if ( important ) {
                output += ' !' + important;
            }
            output += ';';
        }
    }
    return output;
};

var STYLE_RULE = 1;
var MEDIA_RULE = 4;
var KEYFRAMES_RULE = 7;
var KEYFRAME_RULE = 8;

var sanitiseStylesheet = function ( sheet, output ) {
    var rules = sheet.cssRules;
    var i, l, rule, recurse, selectorText;

    // !rules can occur in Safari; seems it might be caused by the AVG
    // extension. Just bail out.
    if ( !rules ) {
        return output;
    }

    for ( i = 0, l = rules.length; i < l; i += 1 ) {
        rule = rules[i];
        recurse = false;
        switch ( rule.type ) {
        case STYLE_RULE:
            // Firefox can have an undefined selectorText prop in an @page rule
            // that has no contents: `@page {}`. We no longer supporting @page
            // because we can't restrict scope, but leaving comment for later
            // reference.
            selectorText = rule.selectorText || '';
            output.push( sanitiseSelector( selectorText ) );
            output.push( '{' );
            output.push( sanitiseStyle( rule.style ) );
            output.push( '}\n' );
            break;
        case MEDIA_RULE:
            output.push( '@media ' );
            output.push( rule.media.mediaText );
            recurse = true;
            break;
        case KEYFRAMES_RULE:
            output.push( '@keyframes ' );
            output.push( id + '-' + rule.name );
            recurse = true;
            break;
        case KEYFRAME_RULE:
            output.push( rule.keyText );
            output.push( '{' );
            output.push( sanitiseStyle( rule.style ) );
            output.push( '}\n' );
            break;
        }
        if ( recurse ) {
            output.push( '{\n' );
            sanitiseStylesheet( rule, output );
            output.push( '}\n' );
        }
    }
    return output;
};

// --- HTML Sanitiser ---

var uponSanitizeElement = function ( node, data ) {
    // Sanitise CSS
    if ( data.tagName === 'style' ) {
        node.textContent = sanitiseStylesheet( node.sheet, [] ).join( '' );
    }
};

var uponSanitizeAttribute = function ( node, data ) {
    var name = data.attrName;
    var value = data.attrValue;
    // Sanitise CSS
    if ( name === 'style' ) {
        data.attrValue = sanitiseStyle( node.style );
    }
    // Rewrite ids and classes
    if ( name === 'id' || name === 'for' ) {
        data.attrValue = id + '-' + value;
    }
    if ( name === 'class' ) {
        data.attrValue = value.trim().split( /\s+/ ).map(
            function ( className ) {
                return id + '-' + className;
            }).join( ' ' );
    }
};

var afterSanitizeAttributes = function ( node ) {
    if ( node.nodeName === 'A' ) {
        node.rel = 'noreferrer';
        node.target = '_blank';
    }
};

DOMPurify.addHook( 'uponSanitizeElement', uponSanitizeElement );
DOMPurify.addHook( 'uponSanitizeAttribute', uponSanitizeAttribute );
DOMPurify.addHook( 'afterSanitizeAttributes', afterSanitizeAttributes );

var FORBID_TAGS =
    'audio blink decorator element marquee template video'.split( ' ' );
var FORBID_ATTR = 'action method tabindex xmlns'.split( ' ' );

var drawHTML = function ( html ) {
    // Setup global variables
    counter += 1;
    id = 'defanged' + counter;

    // Sanitise the HTML/CSS
    var documentElement = DOMPurify.sanitize( html, {
        FORBID_TAGS: FORBID_TAGS,
        FORBID_ATTR: FORBID_ATTR,
        ALLOW_DATA_ATTR: false,
        WHOLE_DOCUMENT: true,
        RETURN_DOM: true,
        SANITIZE_DOM: true,
    });

    // Now create our custom element and move the children across
    var elements, i, l;
    var output = document.createElement( 'div' );

    output.id = id;
    output.style.cssText = 'z-index:0';

    // Move sanitised nodes into the real document
    documentElement = document.adoptNode( documentElement );

    // Move stylesheets into output node
    elements = Array.prototype.slice.call(
        documentElement.getElementsByTagName( 'style' ) );
    for ( i = 0, l = elements.length; i < l; i += 1 ) {
        output.appendChild( elements[i] );
    }

    // Move body contents into output node
    elements = Array.prototype.slice.call(
        documentElement.lastElementChild.childNodes );
    for ( i = 0, l = elements.length; i < l; i += 1 ) {
        output.appendChild( elements[i] );
    }

    return output;
};

App.drawHTML = drawHTML;

}() );
