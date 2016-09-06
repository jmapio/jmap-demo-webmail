// -------------------------------------------------------------------------- \\
// File: actions.js                                                           \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global JMAP, App */

"use strict";

( function () {

var NO = 0;
var TO_THREAD = 1;
var TO_MAILBOX = 2;

var doAction = function ( storeKeys, expand, action ) {
    var mailboxMessageList = App.state.get( 'mailboxMessageList' ),
        i, messageToThreadSK, mailboxId, mailbox, actionTheMessages, sequence;

    if ( !mailboxMessageList ) {
        return;
    }
    if ( !storeKeys || !( storeKeys instanceof Array ) ) {
        storeKeys = App.state.selection.get( 'selectedStoreKeys' );
    }

    messageToThreadSK = mailboxMessageList.messageToThreadSK;
    mailboxId = ( mailboxMessageList.get( 'filter' ).inMailboxes || [] )[0];
    mailbox = mailboxId ?
        JMAP.store.getRecord( JMAP.Mailbox, mailboxId ) : null;
    actionTheMessages = function ( callback, messages ) {
        action( messages );
        JMAP.mail.addCallback( callback );
    };

    sequence = new JMAP.Sequence();
    for ( i = 0; i < storeKeys.length; i += 50 ) {
        sequence
            .then( JMAP.mail.getMessages.bind( null,
                storeKeys.slice( i, i + 50 ), expand, mailbox, messageToThreadSK
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

    read: function ( messageIds ) {
        doAction( messageIds, TO_THREAD, function ( messages ) {
            JMAP.mail.setUnread( messages, false, true );
        });
        return this;
    },

    unread: function ( messageIds ) {
        doAction( messageIds, TO_THREAD, function ( messages ) {
            JMAP.mail.setUnread( messages, true, true );
        });
        return this;
    },

    flag: function ( messageIds ) {
        doAction( messageIds, NO, function ( messages ) {
            JMAP.mail.setFlagged( messages, true, true );
        });
        return this;
    },

    unflag: function ( messageIds ) {
        doAction( messageIds, TO_THREAD, function ( messages ) {
            JMAP.mail.setFlagged( messages, false, true );
        });
        return this;
    },

    archive: function ( messageIds ) {
        doAction( messageIds, TO_MAILBOX, function ( messages ) {
            var archiveId = JMAP.mail.getMailboxIdForRole( 'archive' ),
                inboxId = JMAP.mail.getMailboxIdForRole( 'inbox' );
            JMAP.mail
                .setUnread( messages, false, true )
                .move( messages, archiveId, inboxId, true );
        });
        return this;
    },

    deleteToTrash: function ( messageIds ) {
        doAction( messageIds, TO_THREAD, function ( messages ) {
            JMAP.mail.move( messages,
                JMAP.mail.getMailboxIdForRole( 'trash' ), null, true );
        });
        return this;
    },

    move: function ( messageIds, destinationId ) {
        doAction( messageIds, TO_MAILBOX, function ( messages ) {
            var spamId = JMAP.mail.getMailboxIdForRole( 'spam' );
            if ( destinationId === spamId ) {
                JMAP.mail.report( messages, true, true );
            }
            if ( App.state.get( 'mailboxId' ) === spamId ) {
                JMAP.mail.report( messages, false, true );
            }
            JMAP.mail.move(
                messages, destinationId, App.state.get( 'mailboxId' ), true );
        });
        return this;
    }
};

App.actions = actions;

}() );
