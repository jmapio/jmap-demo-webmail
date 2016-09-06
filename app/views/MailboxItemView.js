// -------------------------------------------------------------------------- \\
// File: MailboxItemView.js                                                   \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, App, JMAP */

"use strict";

( function () {

var filterIsSentOrDraft = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.every( filterIsSentOrDraft );
    }
    var inMailboxes = filter.inMailboxes;
    return !!inMailboxes && inMailboxes.every( function ( mailboxId ) {
        return JMAP.store.getRecord( JMAP.Mailbox, mailboxId )
                         .get( 'isForSentOrDraft' );
    });
};
var filterIsText = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( filterIsText );
    }
    for ( var prop in filter ) {
        if ( typeof filter[ prop ] === 'string' && filter[ prop ] &&
                prop !== 'category' ) {
            return true;
        }
    }
    return false;
};

var READY = O.Status.READY;

var MailboxItemView = O.Class({

    Extends: O.ListItemView,

    Mixin: [ O.AnimatableView, O.Draggable, O.DragDataSource ],

    itemHeight: 96,

    init: function ( mixin ) {
        this.isInTrash = false;
        this.isFlagged = false;
        this.isUnread = false;

        this.isAdded = false;
        this.isRemoved = false;

        this.thread = null;

        MailboxItemView.parent.init.call( this, mixin );

        var message = mixin.content;
        if ( message ) {
            message.addObserverForKey( '*', this, 'messageDidChange' );
            this.messageDidChange();
        }
        if ( mixin.isAdded ) {
            this.resetAnimationState();
        }
    },

    destroy: function () {
        var message = this.get( 'content' ),
            thread = this.get( 'thread' );
        if ( message ) {
            message.removeObserverForKey( '*', this, 'messageDidChange' );
        }
        if ( thread ) {
            thread.removeObserverForKey( '*', this, 'threadDidChange' );
        }
        MailboxItemView.parent.destroy.call( this );
    },

    detach: function ( wasRemovedFromList ) {
        if ( wasRemovedFromList && this.get( 'isInDocument' ) ) {
            this.set( 'isRemoved', true );
        } else {
            MailboxItemView.parent.detach.call( this );
            this.destroy();
        }
    },

    didAnimate: function () {
        this.increment( 'animating', -1 );
        if ( this.get( 'isRemoved' ) ) {
            this.detach( false );
        }
    },

    didLeaveDocument: function () {
        MailboxItemView.parent.didLeaveDocument.call( this );
        // Handle case where we were going to animate out, but parent removed
        // from doc before we started animating
        if ( this.get( 'isRemoved' ) &&
                !this.get( 'parentView' ).get( 'isInDocument' ) ) {
            this.detach( false );
        }
        return this;
    },

    resetAnimationState: function () {
        this.set( 'isAdded', false )
            .set( 'animateLayer', true );
    }.queue( 'after' ),

    listDidChange: function () {
        this.set( 'animateLayer', false );
        if ( this.thread ) {
            this.threadDidChange();
        }
        this.propertyNeedsRedraw( this, 'layer' );
        this.resetAnimationState();
    }.observes( 'list' ),

    messageDidChange: function () {
        var message = this.get( 'content' );
        if ( message.is( READY ) ) {
            if ( this.get( 'list' ).get( 'collapseThreads' ) ) {
                if ( !this.get( 'thread' ) ) {
                    var thread = message.get( 'thread' );
                    thread.addObserverForKey( '*', this, 'threadDidChange' );
                    this.set( 'thread', thread )
                        .threadDidChange();
                }
            } else {
                this.set( 'isUnread',
                        !message.get( 'isDraft' ) && message.get( 'isUnread' ) )
                    .set( 'isFlagged', message.get( 'isFlagged' ) );
            }
            this.propertyNeedsRedraw( this, 'layer' );
        }
    },

    threadDidChange: function () {
        var thread = this.get( 'thread' ),
            inMailboxes, isInTrash;
        if ( thread.is( READY ) ) {
            inMailboxes = this.getFromPath( 'list.filter.inMailboxes' );
            isInTrash = this.isInTrash = inMailboxes &&
                inMailboxes.length === 1 &&
                inMailboxes[0] === JMAP.mail.getMailboxIdForRole( 'trash' );
            this.set( 'isUnread', isInTrash ?
                    thread.get( 'isUnreadInTrash' ) :
                    thread.get( 'isUnread' )
                )
                .set( 'isFlagged', isInTrash ?
                    thread.get( 'isFlaggedInTrash' ) :
                    thread.get( 'isFlagged' )
                );
            this.propertyNeedsRedraw( this, 'layer' );
        }
    },

    layout: function () {
        var index = this.get( 'index' ),
            itemHeight = this.get( 'itemHeight' ),
            isRemoved = this.get( 'isRemoved' ),
            isAdded = this.get( 'isAdded' );
        return {
            top: 0,
            left: 0,
            transform:
                'translate3d(0,' +
                    ( ( index - ( isAdded ? 1 : 0 ) ) * itemHeight ) + 'px,' +
                '0)',
            opacity: isRemoved ? 0 : 1
        };
    }.property( 'index', 'itemHeight', 'isAdded', 'isRemoved' ),

    className: function () {
        return 'v-MailboxItem' +
            ( this.get( 'isSelected' ) ? ' is-selected' : '' ) +
            ( this.get( 'isUnread' ) ? ' is-unread' : '' ) +
            ( this.get( 'isFlagged' ) ? ' is-flagged': '' );
    }.property( 'isSelected', 'isUnread', 'isFlagged' ),

    draw: function ( layer, Element, el ) {
        var message = this.get( 'content' ),
            thread = this.get( 'thread' ),
            isInTrash = this.get( 'isInTrash' ),
            isReady = !!message && !!thread && thread.isAll( READY );

        if ( !isReady ) {
            return null;
        }

        var list = this.get( 'list' ),
            filter = list.get( 'filter' ),
            showTo = filterIsSentOrDraft( filter ),
            name = ( showTo ?
                    message.get( 'to' ) :
                    thread.get( isInTrash ? 'sendersInTrash' : 'senders' )
                ).map( function ( person ) {
                    return person.name || person.email;
                }).join( ', ' ),
            date = message.get( 'date' ),
            total = thread.get( isInTrash ? 'totalInTrash' : 'total' ),
            subject = message.get( 'subject' );

        if ( total > 1 ) {
             subject = subject.replace( /^(?:re|fwd):\s*/i, '' );
        }
        return [
            el( 'span.v-MailboxItem-name', [
                name
            ]),
            el( 'time.v-MailboxItem-time', [
                date.isToday() ?
                    O.i18n.date( date, 'time' ) :
                    O.i18n.date( date, 'date' )
            ]),
            el( 'span.v-MailboxItem-subject', [
                subject
            ]),
            total > 1 ?
            el( 'span.v-MailboxItem-total', [
                total + ''
            ]) : null,
            el( 'span.v-MailboxItem-preview', [
                message.get( 'preview' )
            ]),
            el( 'button.v-MailboxItem-flagButton.icon-star' )
        ];
    },

    onClick: function ( event ) {
        var message = this.get( 'content' ),
            target = event.target;

        event.stopPropagation();

        // If full message hasn't been rendered, ignore the click.
        // Also ignore right clicks.
        if ( event.button || !message ||
                this.get( 'layer' ).childNodes.length < 2 ) {
            return;
        }

        // Pin button -> Pin/unflag message
        if ( target.nodeName === 'BUTTON' ) {
            JMAP.mail.setFlagged(
                [ message ], !message.get( 'isFlagged' ), false );
            return;
        }

        // Select message
        var index = this.get( 'index' );
        if ( event.shiftKey ||
                ( O.UA.isMac ? event.metaKey : event.ctrlKey ) ) {
            if ( this.get( 'isSelected' ) &&
                    App.state.selectedMessage.get( 'record' ) === message ) {
                App.state.selectedMessage.set( 'record', null );
            }
            App.state.selection.selectIndex(
                index,
                !this.get( 'isSelected' ),
                event.shiftKey
            );
        } else {
            App.state.selection
                .selectNone()
                .selectIndex( index, true, false );
            App.state.selectedMessage
                .set( 'index', index );
        }
    }.on( 'click' ),

    // --- Drag & Drop ---

    dragStarted: function ( drag ) {
        // Detect item being dragged.
        var message = this.get( 'content' );
        if ( message && message.is( READY ) ) {
            // Set drag image
            var selection = App.state.selection;
            var storeKey = message.get( 'storeKey' );
            var count = selection.isStoreKeySelected( storeKey ) ?
                    selection.get( 'length' ) : 1;
            var el = O.Element.create;

            drag._draggedStoreKey = id;
            drag.set( 'dragImage', el( 'div.v-MailboxItem-drag', [
                O.i18n.localise(
                    '[*2,_1,1 conversation,%n conversations]', count )
            ]));
        } else {
            drag.endDrag();
        }
    },

    // --- DragDataSource ---

    dragDataTypes: [ 'MessageStoreKeys' ],

    getDragDataOfType: function ( type, drag ) {
        var storeKey = drag._draggedStoreKey;
        var selection = App.state.selection;
        if ( storeKey && type === 'MessageStoreKeys' ) {
            return selection.isStoreKeySelected( storeKey ) ?
                selection.get( 'selectedStoreKeys' ) : [ storeKey ];
        }
    }
});

App.MailboxItemView = MailboxItemView;

}() );
