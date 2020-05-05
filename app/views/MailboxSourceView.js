// -------------------------------------------------------------------------- \\
// File: MailboxItemView.js                                                   \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, App */

( function () {

const el = O.Element.create;

// ---

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

    draw: function ( layer ) {
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
                }),
            }),
            badgeProperty ?
            el( 'div.v-MailboxSource-count', {
                text: O.bind( mailbox, badgeProperty, function ( count ) {
                    return count ? count + '' : '';
                }),
            }) : null,
        ];
    },

    select: function () {
        App.state.set( 'mailbox', this.get( 'content' ) );
    }.on( 'click' ),

    // --- DropTarget ---

    dropAcceptedDataTypes: {
        MessageStoreKeys: true,
    },

    dropEntered: function ( drag ) {
        if ( this.get( 'content' ).get( 'myRights' ).mayAddItems ) {
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
        if ( mailbox.get( 'myRights' ).mayAddItems ) {
            drag.getDataOfType( 'MessageStoreKeys', function ( storeKeys ) {
                if ( storeKeys ) {
                    App.actions.move( storeKeys, mailbox );
                }
            });
        }
    },
});

App.MailboxSourceView = MailboxSourceView;

}() );
