// -------------------------------------------------------------------------- \\
// File: MessageView.js                                                       \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, App, JMAP */

"use strict";

( function () {

var drawNames = function ( people ) {
    return people.reduce( function ( result, person, i ) {
        if ( i ) {
            result.push( ', ' );
        }
        result.push( O.Element.create( 'span', {
            text: person.name || person.email.split( '@' )[0],
            title: person.email
        }));
        return result;
    }, [] );
};

var READY = O.Status.READY;

var MessageView = O.Class({

    Extends: O.View,

    isFlagged: O.bind( 'content.isFlagged' ),
    isUnread: O.bind( 'content.isUnread' ),
    status: O.bind( 'content.status' ),

    // Last message in thread - start expanded.
    isLast: false,

    className: function () {
        return 'v-Message ' +
            ( this.get( 'isExpanded' ) ? 'is-expanded' : 'is-collapsed' ) +
            ( this.get( 'isLast' ) ? ' is-last' : '' );
    }.property( 'isExpanded', 'isLast' ),

    init: function ( options ) {
        MessageView.parent.init.call( this, options );

        this._scrollView = null;
        this._hasDrawnBody = false;
        this._header = null;
        this._body = null;
        this._loading = null;
        this._observingDetails = false;
        this._markReadTimer = null;

        this.isExpanded = false;
        this.checkIfExpanded();

    },

    destroy: function () {
        if ( this._observingDetails ) {
            this._observingDetails = false;
            this.get( 'content' ).removeObserverForKey(
                'detailsStatus', this, 'messageDidLoad' );
        }
        O.RunLoop.cancel( this._markReadTimer );
        MessageView.parent.destroy.call( this );
    },

    fetchDetails: function () {
        var message = this.get( 'content' );
        if ( message.get( 'detailsStatus' ) !== READY ) {
            message.fetchDetails();
            message.addObserverForKey(
                'detailsStatus', this, 'messageDidLoad' );
            this._observingDetails = true;
        }
    },

    messageDidLoad: function ( message ) {
        // Check the data has now loaded.
        if ( message.get( 'detailsStatus' ) !== READY ) {
            return;
        }
        // We don't need to observe this anymore.
        // This must happen before the body render, as rendering the body will
        // mark the message read, which will change the status, thus triggering
        // this event; nasty infinite loop bug.
        this._observingDetails = false;
        message.removeObserverForKey( 'detailsStatus', this, 'messageDidLoad' );

        // Render the real body if we have a 'Loading' message rendered
        if ( this.get( 'isRendered' ) && this.get( 'isExpanded' ) ) {
            this.propertyNeedsRedraw( this, 'isExpanded' );
        }
    },

    refreshMessage: function ( self, status ) {
        if ( self.get( status ) & O.Status.OBSOLETE ) {
            self.get( 'content' ).refresh();
        }
    }.observes( 'status' ),

    checkIfExpanded: function () {
        var isExpanded = this.get( 'isUnread' ) || this.get( 'isLast' );
        if ( isExpanded ) {
            this.set( 'isExpanded', isExpanded );
        }
    }.observes( 'isUnread', 'isLast' ),

    expandedDidChange: function () {
        if ( this.get( 'isExpanded' ) && !this._hasDrawnBody ) {
            this.fetchDetails();
            this.propertyNeedsRedraw( this, 'isExpanded' );
        }
    }.observes( 'isExpanded' ),

    // Render =================================

    draw: function ( layer, Element, el ) {
        var message = this.get( 'content' ),
            detailsAreLoaded = message.get( 'detailsStatus' ) === READY,
            email = message.get( 'fromEmail' ),
            fromName = message.get( 'fromName' ),
            receivedAt = message.get( 'receivedAt' ),
            contact = JMAP.contacts.getContactFromEmail( email ),
            bind = O.bind,
            contactName;

        if ( contact ) {
            contactName = contact.get( 'name' );
            if ( contactName.toLowerCase()
                            .contains( fromName.toLowerCase() ) ) {
                fromName = contactName;
            }
        }

        return [
            this._header = el( 'div.v-Message-header', [
                el( 'img.v-Message-avatar', {
                    src: 'https://secure.gravatar.com/avatar/' +
                        email.trim().toLowerCase().md5() +
                        '/?s=100&d=monsterid'
                }),
                el( 'div.v-Message-first', [
                    el( 'h2.v-Message-from', [
                        fromName
                    ]),
                    el( 'div.v-Message-mailboxes', {
                        children: bind( message, 'mailboxes',
                        function ( mailboxes ) {
                            return [
                                mailboxes.map( function (mailbox ) {
                                    return mailbox.get( 'name' );
                                }).join( ', ' )
                            ];
                        })
                    }),
                    el( 'div.v-Message-time', [
                        receivedAt.isToday() ?
                            O.i18n.date( receivedAt, 'time' ) :
                            O.i18n.date( receivedAt, 'date' )
                    ])
                ]),
                el( 'div.v-Message-to', [
                    ' to ',
                    drawNames( message.get( 'to' ) )
                ]),
                el( 'div.v-Message-preview', [
                    message.get( 'preview' )
                ]),
                new O.ButtonView({
                    icon: 'icon-star',
                    type: bind( this, 'isFlagged', function ( isFlagged ) {
                        return 'v-Message-flagButton ' +
                            ( isFlagged ? 'is-flagged' : 'is-unflagged' );
                    }),
                    positioning: 'absolute',
                    target: this,
                    method: 'toggleFlagged'
                })
            ]),
            detailsAreLoaded && this.get( 'isExpanded' ) ?
                this._drawBody() :
                this._loading = el( 'div.v-Message-body', [
                    'Loading…'
                ])
        ];
    },
    // #end

    _drawBody: function () {
        var message = this.get( 'content' );
        var textBody = message.get( 'textBody' );
        var htmlBody = message.get( 'htmlBody' );
        var el = O.Element.create;

        if ( this.get( 'isUnread' ) ) {
            this._markReadTimer =
                O.RunLoop.invokeAfterDelay( this.markRead, 1000, this );
        }

        this._hasDrawnBody = true;
        this.checkSize();
        return this._body = el( 'div.v-Message-body', [
            htmlBody ?
                App.drawHTML( htmlBody ) :
                el( 'pre', [
                    textBody
                ])
        ]);
    },

    redrawIsExpanded: function () {
        if ( this.get( 'content' ).get( 'detailsStatus' ) === READY &&
                !this._hasDrawnBody ) {
            this.get( 'layer' ).replaceChild( this._drawBody(), this._loading );
            this._loading = null;
        }
    },

    setListener: function () {
        var layer = this.get( 'layer' );
        if ( this.get( 'isInDocument' ) ) {
            layer.addEventListener( 'load', this, true );
        } else {
            layer.removeEventListener( 'load', this, true );
        }
    }.observes( 'isInDocument' ),

    checkSize: function () {
        var body = this._body,
            style, pxWidth, pxHeight, scrollWidth, scrollHeight;
        if ( body && this.get( 'isInDocument' ) ) {
            style = body.style;
            if ( style.height ) {
                style.height = '';
            }
            if ( style.width ) {
                style.width = '';
            }
            pxWidth = body.offsetWidth;
            pxHeight = body.offsetHeight;
            scrollWidth = body.scrollWidth;
            scrollHeight = body.scrollHeight;
            if ( pxWidth < scrollWidth ) {
                style.width = scrollWidth + 'px';
            }
            if ( pxHeight < scrollHeight ) {
                style.height = scrollHeight + 'px';
            }
        }
    }.queue( 'after' ).on( 'load' ),

    // Actions ================================

    onClick: function ( event ) {
        // Ignore right clicks
        if ( event.button || event.metaKey || event.ctrlKey ) { return; }

        if ( !( event.targetView instanceof O.ButtonView ) &&
                O.Element.contains( this._header, event.target ) &&
                !this.get( 'isLast' ) ) {
            this.toggle( 'isExpanded' );
        }
    }.on( 'click' ),

    toggleFlagged: function () {
        var isFlagged = !this.get( 'isFlagged' ),
            message = this.get( 'content' );
        JMAP.mail.setFlagged( [ message ], isFlagged, false );
    },

    markRead: function () {
        JMAP.mail.setUnread( [ this.get( 'content' ) ], false, false );
    }
});

App.MessageView = MessageView;

}() );
