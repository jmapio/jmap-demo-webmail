// -------------------------------------------------------------------------- \\
// File: MailboxItemView.js                                                   \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, App */

"use strict";

( function () {

var MailboxSourceView = O.Class({

    Extends: O.View,

    Mixin: O.DropTarget,

    isSelected: O.bind( App, 'state*mailbox', function ( mailbox ) {
        return mailbox === this.toObject.content;
    }),

    className: function () {
        return 'v-MailboxSource' +
            ( this.get( 'isSelected' ) ? ' is-selected' : '' ) +
            ( this.get( 'hasDragOver' ) ? ' is-underDrag' : '' );
    }.property( 'isSelected', 'hasDragOver' ),

    draw: function ( layer, Element, el ) {
        var mailbox = this.get( 'content' ),
            role = mailbox.get( 'role' ),
            badgeProperty = ( role === 'drafts' ) ? 'totalMessages' :
                ( role === 'sent' || role === 'archive' ) ?
                    null : 'unreadThreads';
        return [
            el( 'div.v-MailboxSource-name', {
                style: O.bind( mailbox, 'depth', function ( depth ) {
                    return 'text-indent:' + ( depth * 15 ) + 'px';
                }),
                text: O.bind( mailbox, 'name' ),
                title: O.bind( mailbox, 'totalThreads', function ( total ) {
                    return O.i18n.localise(
                        '[*2,_1,1 conversation,%n conversations]', total );
                })
            }),
            badgeProperty ?
            el( 'div.v-MailboxSource-count', {
                text: O.bind( mailbox, badgeProperty, function ( count ) {
                    return count ? count + '' : '';
                })
            }) : null
        ];
    },

    select: function () {
        App.state.set( 'mailboxId', this.get( 'content' ).get( 'id' ) );
    }.on( 'click' ),

    // --- DropTarget ---

    dropAcceptedDataTypes: {
        MessageIds: true
    },

    dropEntered: function ( drag ) {
        if ( this.get( 'content' ).get( 'mayAddItems' ) ) {
            this.set( 'hasDragOver', true );
            drag.set( 'dropEffect', O.DragEffect.MOVE );
        }
    },
    dropExited: function ( drag ) {
        this.set( 'hasDragOver', false );
        drag.set( 'dropEffect', O.DragEffect.DEFAULT );
    },
    drop: function ( drag ) {
        var mailbox = this.get( 'content' );
        if ( mailbox.get( 'mayAddItems' ) ) {
            drag.getDataOfType( 'MessageIds', function ( messageIds ) {
                if ( messageIds ) {
                    App.actions.move( messageIds, mailbox.get( 'id' ) );
                }
            });
        }
    }
});

App.MailboxSourceView = MailboxSourceView;

}() );
