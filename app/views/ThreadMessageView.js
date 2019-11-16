// -------------------------------------------------------------------------- \\
// File: ThreadMessageView.js                                                 \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, App */

"use strict";

( function () {

const el = O.Element.create;
var READY = O.Status.READY;

// ---

var ThreadMessageView = O.Class({

    Extends: O.View,

    className:'v-ThreadMessage',

    destroy: function () {
        var content = this.get( 'content' );
        if ( content && this.get( 'isRendered' ) ) {
            content.removeObserverForKey( 'status', this, 'contentDidLoad' );
        }
        ThreadMessageView.parent.destroy.call( this );
    },

    draw: function (/* layer */) {
        var content = this.get( 'content' );
        if ( content && content.is( READY ) ) {
            var view = new App.MessageView({
                content: content,
                isLast: this.get( 'isLast' )
            });
            this.insertView( view );
        } else {
            if ( content ) {
                content.addObserverForKey( 'status', this, 'contentDidLoad' );
            }
        }
    },

    redrawLayer: function ( layer ) {
        var Element = O.Element;
        this.draw( layer, Element, Element.create );
    },

    contentDidLoad: function ( content, key ) {
        if ( content.is( READY ) ) {
            content.removeObserverForKey( key, this, 'contentDidLoad' );
            this.propertyNeedsRedraw( this, 'layer' );
        }
    },

    isLast: false,
    setIsLast: function () {
        var siblings = this.getFromPath( 'parentView.childViews' );
        this.set( 'isLast', !!( siblings && siblings.last() === this ) );
    }.observes( 'parentView.childViews' ),

    indexDidChange: function () {
        var children = this.get( 'childViews' ),
            isLast = this.get( 'isLast' ),
            l = children.length;
        while ( l-- ) {
            children[l].set( 'isLast', isLast );
            // Only the last child is last!
            isLast = false;
        }
    }.observes( 'index', 'isLast', 'childViews' )
});

App.ThreadMessageView = ThreadMessageView;

}() );
