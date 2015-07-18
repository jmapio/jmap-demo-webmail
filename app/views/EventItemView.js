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

var EventItemView = O.Class({

    Extends: O.View,

    className: 'v-EventItem',

    layerTag: 'li',

    draw: function ( layer, Element, el ) {
        var event = this.get( 'content' ),
            date = this.getParent( O.ListView ).get( 'content' ).get( 'date' ),
            isAllDay = event.get( 'isAllDay' ),
            start = event.get( 'start' ),
            summary = event.get( 'summary' ),
            location = event.get( 'location' ),
            time, end;

        if ( isAllDay ) {
            time = 'All day';
        } else if ( !start.isOnSameDayAs( date, true ) ) {
            end = event.get( 'end' );
            time = end.isOnSameDayAs( date, true ) ?
                'ends at ' + O.i18n.date( end, 'time', true ) :
                time = 'All day';
        } else {
            time = O.i18n.date( start, 'time', true );
        }

        return [
            el( 'h3.v-EventItem-summary', {
                style: 'color:' + event.get( 'calendar' ).get( 'color' ),
                text: summary || ' ' // nbsp;
            }),
            el( 'h4.v-EventItem-time', [ time ] ),
            location ? el( 'p.v-EventItem-location', [ location ] ) : null
        ];
    },

    eventNeedsRedraw: function () {
        this.propertyNeedsRedraw( this, 'layer' );
    }.observes( 'content.*' )
});

App.EventItemView = EventItemView;

}() );
