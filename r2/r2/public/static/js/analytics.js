r.analytics = {
  init: function() {
    // these guys are relying on the custom 'onshow' from jquery.reddit.js
    $(document).delegate(
      '.organic-listing .promotedlink.promoted',
      'onshow',
      _.bind(function(ev) {
        this.fireTrackingPixel(ev.target);
      }, this)
    );

    $('.promotedlink.promoted:visible').trigger('onshow');
    $('form.gold-checkout').one('submit', this.fireGoldCheckout);

    // dont track sponsor's activity
    r.analytics.addEventPredicate('ads', function() {
      return !r.config.is_sponsor;
    });

    // virtual page tracking for ads funnel
    if (r.config.ads_virtual_page) {
      r.analytics.fireFunnelEvent('ads', r.config.ads_virtual_page);
    }
  },

  _eventPredicates: {},

  addEventPredicate: function(category, predicate) {
    var predicates = this._eventPredicates[category] || [];

    predicates.push(predicate);

    this._eventPredicates[category] = predicates;
  },

  shouldFireEvent: function(category/*, arguments*/) {
    var args = _.rest(arguments);

    return !this._eventPredicates[category] ||
        this._eventPredicates[category].every(function(fn) {
          return fn.apply(this, args);
        });
  },

  _isGALoaded: false,

  isGALoaded: function() {
    // We've already passed this test, just return `true`
    if (this._isGALoaded) {
      return true;
    }

    // GA hasn't tried to load yet, so we can't know if it
    // will succeed.
    if (_.isArray(_gaq)) {
      return undefined;
    }

    var test = false;

    _gaq.push(function() {
      test = true;
    });

    // Remember the result, so we only have to run this test once
    // if it passes.
    this._isGALoaded = test;

    return test;
  },

  _wrapCallback: function(callback) {
    var original = callback;

    original.called = false;
    callback = function() {
      if (!original.called) {
        original();
        original.called = true;
      }
    };

    // GA may timeout.  ensure the callback is called.
    setTimeout(callback, 500);

    return callback;
  },

  fireFunnelEvent: function(category, action, options, callback) {
    options = options || {};
    callback = callback || function() {};

    if (!window._gaq || !this.shouldFireEvent.apply(this, arguments)) {
      callback();
      return;
    }

    var isGALoaded = this.isGALoaded();

    if (!isGALoaded) {
      callback = this._wrapCallback(callback);
    }

    // Virtual page views are needed for a funnel to work with GA.
    // see: http://gatipoftheday.com/you-can-use-events-for-goals-but-not-for-funnels/
    _gaq.push(['_trackPageview', '/' + _.compact([category, action, options.label]).join('-')]);

    // The goal can have a conversion value in GA.
    if (options.value) {
      _gaq.push(['_trackEvent', category, action, options.label, options.value]);
    }

    _gaq.push(callback);
  },

  fireGAEvent: function(category, action, opt_label, opt_value, opt_noninteraction, callback) {
    opt_label = opt_label || '';
    opt_value = opt_value || 0;
    opt_noninteraction = !!opt_noninteraction;
    callback = callback || function() {};

    if (!window._gaq || !this.shouldFireEvent.apply(this, arguments)) {
      callback();
      return;
    }

    var isGALoaded = this.isGALoaded();

    if (!isGALoaded) {
      callback = this._wrapCallback(callback);
    }

    _gaq.push(['_trackEvent', category, action, opt_label, opt_value, opt_noninteraction]);
    _gaq.push(callback);
  },

  fireTrackingPixel: function(el) {
    var $el = $(el);
    var onCommentsPage = $('body').hasClass('comments-page');

    if ($el.data('trackerFired') || onCommentsPage) {
      return;
    }

    var pixel = new Image();
    var impPixel = $el.data('impPixel');

    if (impPixel) {
      pixel.src = impPixel;
    }

    var adServerPixel = new Image();
    var adServerImpPixel = $el.data('adserverImpPixel');
    var adServerClickUrl = $el.data('adserverClickUrl');

    if (adServerImpPixel) {
      adServerPixel.src = adServerImpPixel;
    }

    $el.data('trackerFired', true);
  },

  fireUITrackingPixel: function(action, srname, extraParams) {
    var pixel = new Image();
    pixel.src = r.config.uitracker_url + '?' + $.param(
      _.extend(
        {
          act: action,
          sr: srname,
          r: Math.round(Math.random() * 2147483647), // cachebuster
        },
        r.analytics.breadcrumbs.toParams(),
        extraParams
      )
    );
  },

  fireGoldCheckout: function(event) {
    var form = $(this);
    var vendor = form.data('vendor');

    form.parent().addClass('working');

    // If we don't have _gaq, just return and let the event bubble and
    // call its own submit.
    if (!window._gaq) {
      return;
    }
    
    // Track a virtual pageview indicating user went off-site to "vendor."
    // If GA is loaded, have GA process form submission after firing
    // (and cancel the default).
    _gaq.push(['_trackPageview', '/gold/external/' + vendor]);
    _gaq.push(function() {
      // Give GA half a second to send out its pixel.
      setTimeout(function() {
        form.submit();
      }, 500);
    });

    if (_gat && _gat._getTracker){
      // GA is loaded; form will submit via the _gaq.push'ed function
      event.preventDefault();
      event.stopPropagation();
    }
  },
};

r.analytics.breadcrumbs = {
  selector: '.thing, .side, .sr-list, .srdrop, .tagline, .md, .organic-listing, .gadget, .sr-interest-bar, .trending-subreddits, a, button, input',
  maxLength: 3,
  sendLength: 2,

  init: function() {
    this.hasSessionStorage = this._checkSessionStorage();
    this.data = this._load();

    var refreshed = this.data[0] && this.data[0].url == window.location;
    if (!refreshed) {
      this._storeBreadcrumb();
    }

    $(document).delegate('a, button', 'click', $.proxy(function(ev) {
      this.storeLastClick($(ev.target));
    }, this));
  },

  _checkSessionStorage: function() {
    // Via modernizr.com's sessionStorage check.
    try {
      sessionStorage.setItem('__test__', 'test');
      sessionStorage.removeItem('__test__');
      return true;
    } catch(e) {
      return false;
    }
  },

  _load: function() {
    if (!this.hasSessionStorage) {
      return [{stored: false}];
    }

    var data;

    try {
      data = JSON.parse(sessionStorage.breadcrumbs);
    } catch (e) {
      data = [];
    }

    if (!_.isArray(data)) {
      data = [];
    }

    return data;
  },

  store: function() {
    if (this.hasSessionStorage) {
      sessionStorage.breadcrumbs = JSON.stringify(this.data);
    }
  },

  _storeBreadcrumb: function() {
    var cur = {
      url: location.toString(),
    };

    if ('referrer' in document) {
      var referrerExternal = !document.referrer.match('^' + r.config.currentOrigin);
      var referrerUnexpected = this.data[0] && document.referrer != this.data[0].url;

      if (referrerExternal || referrerUnexpected) {
        cur.ref = document.referrer;
      }
    }

    this.data.unshift(cur);
    this.data = this.data.slice(0, this.maxLength);
    this.store();
  },

  storeLastClick: function(el) {
    try {
      this.data[0].click =
        r.utils.querySelectorFromEl(el, this.selector);
      this.store();
    } catch (e) {
      // Band-aid for Firefox NS_ERROR_DOM_SECURITY_ERR until fixed.
    }
  },

  lastClickFullname: function() {
    var lastClick = _.find(this.data, function(crumb) {
      return crumb.click;
    });

    if (lastClick) {
      var match = lastClick.click.match(/.*data-fullname="(\w+)"/);
      return match && match[1];
    }
  },

  toParams: function() {
    params = [];
    for (var i = 0; i < this.sendLength; i++) {
      _.each(this.data[i], function(v, k) {
        params['c' + i + '_' + k] = v;
      });
    }
    return params;
  },

};
