// -------------------------------------------------------------------------- \\
// File: actions.js                                                           \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global JMAP, App */

"use strict";

( function () {

var NO = 0;
var TO_THREAD = 1;
var TO_MAILBOX = 2;

var doAction = function ( storeKeys, expand, action ) {
    var mailboxMessageList = App.state.get( 'mailboxMessageList' ),
        i, mailboxId, mailbox, actionTheMessages, sequence;

    if ( !mailboxMessageList ) {
        return;
    }
    if ( !storeKeys || !( storeKeys instanceof Array ) ) {
        storeKeys = App.state.selection.get( 'selectedStoreKeys' );
    }

    mailboxId = mailboxMessageList.get( 'filter' ).inMailbox;
    mailbox = mailboxId ?
        JMAP.store.getRecord( null, JMAP.Mailbox, mailboxId ) : null;
    actionTheMessages = function ( callback, messages ) {
        action( messages );
        // Don't wait for the final batch to commit; anything <50
        // should update UI immediately
        if ( sequence.index < sequence.length ) {
            JMAP.mail.addCallback( callback );
        } else {
            callback();
        }
    };

    sequence = new JMAP.Sequence();
    for ( i = 0; i < storeKeys.length; i += 50 ) {
        sequence
            .then( JMAP.mail.getMessages.bind( null,
                storeKeys.slice( i, i + 50 ), expand, mailbox
            )).then( actionTheMessages );
    }
    sequence.afterwards = function () {
        if ( JMAP.mail.undoManager.pending.length ) {
            JMAP.mail.undoManager.saveUndoCheckpoint();
        }
    };
    sequence.go();
};

var actions = {

    read: function ( storeKeys ) {
        doAction( storeKeys, TO_THREAD, function ( messages ) {
            JMAP.mail.setUnread( messages, false, true );
        });
        return this;
    },

    unread: function ( storeKeys ) {
        doAction( storeKeys, TO_THREAD, function ( messages ) {
            JMAP.mail.setUnread( messages, true, true );
        });
        return this;
    },

    flag: function ( storeKeys ) {
        doAction( storeKeys, NO, function ( messages ) {
            JMAP.mail.setKeyword( messages, '$flagged', true, true );
        });
        return this;
    },

    unflag: function ( storeKeys ) {
        doAction( storeKeys, TO_THREAD, function ( messages ) {
            JMAP.mail.setKeyword( messages, '$flagged', false, true );
        });
        return this;
    },

    archive: function ( storeKeys ) {
        doAction( storeKeys, TO_MAILBOX, function ( messages ) {
            var archive = JMAP.mail.getMailboxForRole( null, 'archive' );
            var inbox = JMAP.mail.getMailboxForRole( null, 'inbox' );
            JMAP.mail
                .setUnread( messages, false, true )
                .move( messages, archive, inbox, true );
        });
        return this;
    },

    deleteToTrash: function ( storeKeys ) {
        doAction( storeKeys, TO_THREAD, function ( messages ) {
            JMAP.mail.move( messages,
                JMAP.mail.getMailboxForRole( null, 'trash' ), 'ALL', true );
        });
        return this;
    },

    move: function ( storeKeys, destination ) {
        doAction( storeKeys, TO_MAILBOX, function ( messages ) {
            JMAP.mail.move(
                messages, destination, App.state.get( 'mailbox' ), true );
        });
        return this;
    }
};

App.actions = actions;

}() );
