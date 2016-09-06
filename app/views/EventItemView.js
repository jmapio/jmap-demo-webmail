// -------------------------------------------------------------------------- \\
// File: EventItemView.js                                                     \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, App */

"use strict";

( function () {

var left = {
    transform: 'translate3d(-100%,0,0)'
};

var centre = {
    transform: 'translate3d(0,0,0)'
};

var right = {
    transform: 'translate3d(100%,0,0)'
};

var EventItemView = O.Class({

    Extends: O.View,

    Mixin: O.AnimatableView,

    animateLayerDuration: 200,

    animateLayerEasing: O.Easing.easeOut,

    init: function ( mixin ) {
        EventItemView.parent.init.call( this, mixin );
        this._done = false;
        this.setLayout();
    },

    className: 'v-EventItem',

    positioning: 'absolute',

    layerTag: 'li',

    draw: function ( layer, Element, el ) {
        var event = this.get( 'content' ),
            date = this.getParent( O.ListView ).get( 'content' ).get( 'date' ),
            isAllDay = event.get( 'isAllDay' ),
            start = event.get( 'start' ),
            title = event.get( 'title' ),
            location = event.get( 'location' ),
            time, end;

        if ( isAllDay ) {
            time = 'All day';
        } else if ( !start.isOnSameDayAs( date, true ) ) {
            end = event.get( 'end' );
            time = end.isOnSameDayAs( date, true ) ?
                'ends ' + O.i18n.date( end, 'time', true ) :
                time = 'All day';
        } else {
            time = O.i18n.date( start, 'time', true );
        }

        return [
            el( 'h3.v-EventItem-title', {
                style: 'color:' + event.get( 'calendar' ).get( 'color' ),
                text: title || ' ' // nbsp;
            }),
            el( 'h4.v-EventItem-time', [ time ] ),
            location ? el( 'p.v-EventItem-location', [ location ] ) : null
        ];
    },

    eventNeedsRedraw: function () {
        this.propertyNeedsRedraw( this, 'layer' );
    }.observes( 'content.*' ),

    setLayout: function () {
        var isInDocument = this.get( 'isInDocument' ),
            done = this._done;
        this.set( 'layout', O.extend({
            top: this.get( 'index' ) * 60
        }, isInDocument ? done ? right : centre : left ) );
    }.observes( 'index' ),

    didEnterDoc: function () {
        if ( this.get( 'isInDocument' ) ) {
            O.RunLoop.invokeAfterDelay(
                this.setLayout, this.get( 'index' ) * 100, this );
        }
    }.nextLoop().observes( 'isInDocument' ),

    detach: function () {
        this._done = true;
        O.RunLoop.invokeAfterDelay(
            this.setLayout, this.get( 'index' ) * 100, this );
    },

    didAnimate: function () {
        this.increment( 'animating', -1 );
        if ( this.get( 'layout' ).transform === right.transform ) {
            EventItemView.parent.detach.call( this );
            this.destroy();
        }
    }
});

App.EventItemView = EventItemView;

}() );
