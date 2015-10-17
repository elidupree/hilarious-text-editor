(function(){
"use strict";

var reload_page_as_needed_for_dragon_naturallyspeaking = true;
var attempt_to_auto_indent_when_user_enters_a_newline = true;

function reload_soon_for_dragon_naturallyspeaking() {
  if(reload_page_as_needed_for_dragon_naturallyspeaking) {
    setTimeout(function(){
      reload_while_keeping_state();
    }, 0);
  }
}

if(window.console === undefined) {
  window.console = { log: function() {} };
}

var editor = null;
var save_status = document.getElementById('save-status');

var state = {
  auth_token: '',

  current_file: null,

  context_name: '',

  default_file_name: null,

  // filename: true
  editable_files: {},

  // filename: { selectionStart: _, selectionEnd: _, selectionDirection: _}
  remembered_selections: {},

  saving: {
    trying_to_save: false,
    save_interval: null,
    save_req: null,
    last_sync_attempt: null,
    last_edit: 0,
    last_sync_success: null,
    latest_time_that_the_server_has_all_our_data: null // in theory updated continously when the server has our data, but actually only retroactively updated once the user types something to be the moment before they typed
  }
};

// make the state visible in the web console, for debugging.
window.hilarious_editor_state = state;

var intended_editor_width = 80;

function cachebuster() {
  return '' + Date.now() + Math.random();
}

function auth_headers() {
  return {
    'X-Please-Believe-I-Am-Not-Cross-Domain': 'yes',
    'X-Token': state.auth_token
  };
}

function test_auth(callback, failure_callback) {
  $.ajax({
    url: '/test_post_works?'+cachebuster(),
    method: 'POST',
    headers: auth_headers(),
    success: callback,
    failure: failure_callback
  });
}

function set_textarea_contents(text) {
  // goal:
  // delete the undo history
  // this means (at least for firefox) that
  // we need to create an entirely new textarea
  // which initially has the initial contents we
  // want it to have.
  // Use jQuery to create the new textarea so that
  // it can do what it can to work around browsers
  // deleting spaces or such.
  // Create a new id= attr value in case anything
  // is tracking it by id; we need those to see it
  // as a new thing.
  // Initialize all those attrs in the initial creation,
  // and create it outside of a call to $('#textarea_container').html(...),
  // just in case that makes more things see it as a different
  // textarea than the previous one.
  if(editor != null) {
    $(editor).remove();
  }

  var new_textarea = $(
    '<textarea' +
      ' id="' + _.uniqueId('textarea_') + '"' +
      ' spellcheck="false"' +
      '>' +
      _.escape(text) +
      '</textarea>'
      )[0];

  $('#textarea_container').append(new_textarea);

  editor = new_textarea;
}


function call_intermittently_while_trying_to_save() {
//function call_intermittently_when_active() {
//function call_intermittently() {
  var time_unsaved = Date.now() - state.saving.latest_time_that_the_server_has_all_our_data;
  if(time_unsaved > 91000) {
    $(save_status).text('Last saved '+Math.round(time_unsaved/1000/60)+' minutes ago');
  }
  debounced_save();
}
function describe_since(time) {
  var duration = Date.now() - time;
  var date = new Date(time);
  var short_since = "since "+date.getHours()+":"+date.getMinutes()+":"+date.getSeconds();
  if(duration < 6000) {
    return "from the last few seconds";
  } else if(duration < 1.6*60*1000) {
    return short_since + " (" + Math.round(duration/1000) + " seconds ago)";
  } else if(duration < 1.6*3600*1000) {
    return short_since + " (" + Math.round(duration/1000/60) + " minutes ago)";
  } else if(duration < 1.6*86400*1000) {
    return "since " + date + " (" + Math.round(duration/1000/3600) + " hours ago)";
  } else {
    return "since " + date + " (" + Math.round(duration/1000/86400) + " days ago)";
  }
}

// this should be active the millisecond after someone starts typing.
// not 2.5 seconds later when the save attempt starts.
// why bother removing and adding it all the time.
function unsaved_beforeunload(e) {
  // In the time the user is looking at the message, maybe we can
  // squeeze in a save.  An example circumstance where this is useful:
  // if they click "don't close the tab" and then try closing the tab again,
  // hopefully the second time they close the tab it will already be saved
  // so we don't have to warn them again.
  try_save();
  // some changes haven't saved yet!
  //var time_unsaved = Date.now() - state.saving.latest_time_that_the_server_has_all_our_data;
  //var message = "changes from the last " + describe_millisecond_duration(time_unsaved) + " haven't saved yet!"
  var message = "changes " + describe_since(state.saving.latest_time_that_the_server_has_all_our_data) + " haven't saved yet!";
  e.returnValue = message; // some browsers
  return message; // other browsers
}

function we_will_need_to_save() {
  if(!state.saving.trying_to_save) {
    state.saving.trying_to_save = true;
    window.addEventListener('beforeunload', unsaved_beforeunload);
  }
}
function starting_saving() {
  if(!state.saving.save_interval) {
    state.saving.save_interval = setInterval(call_intermittently_while_trying_to_save, 60000);
  }
  we_will_need_to_save();
}
function all_done_saving() {
  state.saving.trying_to_save = false;
  if(state.saving.save_interval !== null) {
    clearInterval(state.saving.save_interval);
  }
  window.removeEventListener('beforeunload', unsaved_beforeunload);
  state.saving.save_req = null;
  $(save_status).empty();
}
// call debounced_save() instead of this
// to make sure we don't try to start saving while the user's
// typing
function try_save() {
  // is 30 seconds enough for saving??
  var req_timeout = 30000;
  if(state.saving.save_req !== null) {
    if(state.saving.last_sync_attempt + req_timeout < Date.now()) {
      state.saving.save_req.abort();
    } else {
      return;
    }
  }
  state.saving.last_sync_attempt = Date.now();
  starting_saving();
  state.saving.save_req = $.ajax({
    url: '/save?'+cachebuster(),
    method: 'POST',
    data: editor.value,
    timeout: req_timeout,
    headers: _.assign({},
      {'Content-Type': 'text/plain; charset=utf-8'},
      {'X-File': state.current_file},
      auth_headers()),
    success: function(data) {
      state.saving.latest_time_that_the_server_has_all_our_data = state.saving.last_sync_success = state.saving.last_sync_attempt;
      state.saving.save_req = null;
      if(state.saving.last_sync_success < state.saving.last_edit) {
        debounced_save();
      } else {
        all_done_saving();
      }
    }
  });
}
var debounced_save = _.debounce(try_save, 2500);

var adjust_editor_height_for_dragon = function(no_need_to_reload_page_for_dragon) {
  // For Dragon, keep the textarea longer than necessary
  // so that we don't have to reload the document as often
  // (we need to reload the document every time we change
  // this).
  if(editor.scrollHeight > editor.clientHeight) {
    var line_height = textarea_line_height();
    editor.style.height = (editor.scrollHeight + (line_height * 200) + 1)+'px';
    // e.g. callers can pass "no need" if pre-DOMReady,
    // or if we are about to do something that will cause a
    // page reload anyway.
    if(!no_need_to_reload_page_for_dragon) {
      reload_soon_for_dragon_naturallyspeaking();
    }
  }
}
// debounce it so that a reload is less likely to have a race condition
// with user-input "input" event that's trying to happen
var debounced_adjust_editor_height_for_dragon = _.debounce(adjust_editor_height_for_dragon, 40);

//function editorchange_less_urgent() {
//  state.saving.last_edit = Date.now();
//  try_save();
//}
//var debounced_editorchange_less_urgent = _.debounce(editorchange_less_urgent, 2500);

function adjust_editor_height(no_need_to_reload_page_for_dragon) {
  if(reload_page_as_needed_for_dragon_naturallyspeaking) {
    debounced_adjust_editor_height_for_dragon(no_need_to_reload_page_for_dragon);
  } else {
    if(editor.scrollHeight > editor.clientHeight) {
      editor.style.height = editor.scrollHeight+'px';
    }
  }
  debounced_compute_line_numbers();
}
function editor_input() {
  //console.log("inp");
  adjust_editor_height();
  var now = Date.now();
  if(state.saving.last_edit <= state.saving.latest_time_that_the_server_has_all_our_data) {
    if(state.saving.latest_time_that_the_server_has_all_our_data < now) {
      state.saving.latest_time_that_the_server_has_all_our_data = now - 1;
    }
  }
  state.saving.last_edit = now;
  we_will_need_to_save();
  debounced_save();
  //debounced_editorchange_less_urgent();
}

function textarea_line_height() {
  return +$(editor).css('line-height').replace(/px$/, '');
}

function compute_line_numbers() {
  var old_textarea_value = state.textarea_value;
  var old_sel = state.remembered_selections[total_current_file()];
  // hmm... old_sel can be out of date because the user could have clicked
  // to change it and we didn't notice. I could detect that in many cases
  // by http://stackoverflow.com/a/5832746 keydown/click/focus/input
  // (does menu "Undo" trigger an "input" event?)
  // For now, guessing the old position by computing a common prefix between
  // new text and old text...
  state.textarea_value = editor.value;
  var new_textarea_value = state.textarea_value;
  save_selection_location();
  var new_sel = state.remembered_selections[total_current_file()];
  var textarea_lines = state.textarea_value.split('\n');
  //console.log("d");
  if(attempt_to_auto_indent_when_user_enters_a_newline) {
     // Dragon sometimes deletes trailing spaces on a line when
     // adding a newline, and the common-prefix code should deal fine
     // with that deletion, so allow this code to trigger on shrinking
     // or staying the same size (character replacement) as well.
     // && old_textarea_value.length < state.textarea_value.length
     //&& textarea_lines.length > old_textarea_value.split('\n').length
     //) {
    var old_textarea_line_count = old_textarea_value.split('\n').length;
    var number_of_additional_lines = textarea_lines.length - old_textarea_line_count;
    if(number_of_additional_lines > 0) {
      //console.log("c");
      var shared_prefix_idx = 0;
      while(
        shared_prefix_idx < new_sel.selectionEnd
        &&
        new_textarea_value.charAt(shared_prefix_idx) ==
        old_textarea_value.charAt(shared_prefix_idx)
        ) {
        shared_prefix_idx += 1;
      }
      var newlines_gone_back = 0;
      while(
        shared_prefix_idx > 0 &&
        newlines_gone_back < number_of_additional_lines &&
        new_textarea_value.charAt(shared_prefix_idx - 1) == '\n'
        ) {
        newlines_gone_back += 1;
        shared_prefix_idx -= 1;
      }
      old_sel.selectionStart = old_sel.selectionEnd = shared_prefix_idx;
      // insertions may have happened recently
      // only auto-indent if we have a good sense of what's happening
      if(
        old_sel.selectionStart == old_sel.selectionEnd && //(console.log("1"), true) &&
        new_sel.selectionStart == new_sel.selectionEnd && //(console.log("2"), true) &&
        new_sel.selectionStart > old_sel.selectionEnd
        && //(console.log("3"), true) &&
        old_textarea_value.substring(0, old_sel.selectionStart) ==
        new_textarea_value.substring(0, old_sel.selectionStart)
        //&& (console.log("4"), true) // &&
        //old_textarea_value.substring(old_sel.selectionEnd) ==
        //new_textarea_value.substring(new_sel.selectionEnd)
        ) {
        //console.log("b");
        var insertion = new_textarea_value.substring(old_sel.selectionStart,
                                                     new_sel.selectionStart);
        var insertion_lines = insertion.split('\n');
        var number_of_inserted_newlines = insertion_lines.length - 1;
        // don't auto indent large pastes (TODO detect count
        // of 'input' events for that?)
        if(number_of_inserted_newlines > 0 && number_of_inserted_newlines <= 2) {
          //console.log("a");
          var r = /\n/g;
          r.lastIndex = old_sel.selectionStart;
          r.exec(new_textarea_value);
          var end_of_line_to_get_indent_from = r.lastIndex - 1;
          //console.log(old_sel.selectionStart, end_of_line_to_get_indent_from);
          var previous_indent = ( //'x'
            new_textarea_value.substring(0, end_of_line_to_get_indent_from)
              .match('(?:^|\n)([ \t]*)[^\n]*$')[1]);
          var indented_new_text = _.map(insertion_lines, function(line, idx) {
            if(idx === 0) {
              return line;
            } else {
              return previous_indent + line;
            }
          }).join('\n');
          //console.log('"' + insertion.replace(/\n/g, 'X') + '"', '"' + indented_new_text.replace(/\n/g, 'X') + '"');
          var extra_characters = indented_new_text.length - insertion.length;
          editor.value = state.textarea_value = new_textarea_value = (
            new_textarea_value.substring(0, old_sel.selectionStart)
            + indented_new_text
            + new_textarea_value.substring(new_sel.selectionStart)
            );
          new_sel.selectionStart += extra_characters;
          new_sel.selectionEnd += extra_characters;
          restore_selection_location();
        }
      }
    }
  }
  var s = '';
  var line_height = textarea_line_height();
  var $testline = $('#testline');
  _.each(textarea_lines, function(line, idx) {
    var lineno = idx + 1;
    // This len/80 version didn't work in some weird cases with long lines
    // where the browsers decide to wrap the lines earlier
    // than the 80th character.  The details seem hard to predict
    // and vary from browser to browser.  (Sometimes for example
    // the browser tries to prevent a displayed-line from beginning
    // with a space character, I think based on experimenting.
    // But it wasn't very consistent.)  In theory "word-break: break-all;"
    // should make them not do that, I think... but in practice,
    // that only works *almost* all the time, not all the time.
    //
    // var lines = Math.max(1, Math.ceil(line.length / intended_editor_width));
    var lines = 1;
    if(line.length > intended_editor_width) {
      // This works more often than the len/80 version, although
      // it still misses a few cases -- at least cases that are
      // fixed by fix_reflow_bugs() so it's important that
      // fix_reflow_bugs gets called when loading a new document.
      // (It's probably too slow and probably unnecessary to call it
      // all the time.)
      $testline.text(line);
      lines = Math.round($testline.prop('scrollHeight') / line_height);
      //console.log(lineno, line.length, lines);
    }
    s += lineno;
    while(lines > 0) {
      s += '\n';
      --lines;
    }
  });
  $testline.empty();
  var $linenos = $('#linenos');
  // It's probably faster not to modify the DOM if there's no change.
  // And there's usually no change.
  var old_linenos_text = $linenos.text();
  if(old_linenos_text !== s) {
    $linenos.text(s);
    fix_reflow_bugs();
    // Just in case we missed something in adjust_editor_height(),
    // here's a related computation:
    if($linenos.height() > $(editor).height()) {
      editor.style.height = $linenos.height() + 'px';
    }
  }
}
var debounced_compute_line_numbers = _.debounce(compute_line_numbers, 50);

$('#textarea_container').on('input', 'textarea', editor_input);

// Make page up and page down scroll the screen rather than the cursor.
//
// Page up/down happen on keydown, not keyup, emperically.
//
// I haven't found a way to mirror the browser's exact animated-scrolling
// behavior or exact number of lines they redundantly show between the
// previous and new scroll position.  MDN says not to use window.scrollByPages
// and in any case that doesn't animate on Firefox(Linux) either:
// https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollByPages
//
// TODO: when all browsers agree on a non-deprecated way to handle
// key-event data, use that.  event.which is "deprecated", but
// event.key, the replacement, isn't implemented by webkit/blink browsers
// as of Sept 2015.
var page_up_key_num = 33;
var page_down_key_num = 34;
function editor_keydown(e) {
  if(e.which === page_up_key_num || e.which === page_down_key_num) {
    e.preventDefault();
    e.stopPropagation();
    var page_height = window.innerHeight;
    var scroll_magnitude = page_height - 3 * textarea_line_height();
    var scroll_amount = ((e.which === page_up_key_num)
                              ? -scroll_magnitude : scroll_magnitude);
    window.scrollBy(0, scroll_amount);
  }
}

$('#textarea_container').on('keydown', 'textarea', editor_keydown);

function repeat(str, count) {
  if(str.repeat) {
    return str.repeat(count);
  } else {
    // shorter version of
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/repeat
    var rpt = '';
    for (;;) {
      if ((count & 1) == 1) {
        rpt += str;
      }
      count >>>= 1;
      if (count === 0) {
        break;
      }
      str += str;
    }
    return rpt;
  }
}

function fix_ch_unit() {
  var fix_needed = false;
  var font_size_str = $('#testline').css('font-size');
  var font_size = +font_size_str.replace(/px$/, '');
  var zeroes = repeat('0', intended_editor_width);
  var $a = $('<div/>').text(zeroes).css({'font-size': font_size_str, 'visibility': 'hidden', 'position': 'absolute', 'top': '0', 'left': '0'});
  var $b = $('<div/>').css({'width': intended_editor_width+'ch', 'font-size': font_size_str, 'visibility': 'hidden', 'position': 'absolute', 'top': '0', 'left': '0'});
  $(document.body).append($a, $b);
  if(Math.abs($a.width() - $b.width()) > 1) {
    // Browsers such as IE (even IE11) that implement the ch unit badly.
    // Use "em" here instead of "px" because like "ch" it's relative to
    // the font size (likely unimportant), and like "ch" it rounds to
    // the nearest pixel so that elements are pixel-aligned (unimportant;
    // we could easily round here by hand).  Round up by a pixel or two
    // because that's sometimes needed.
    var new_width = ($a.width()/font_size + 0.1)+'em';
    console.log('working around poor implementation of "ch" unit: editor now '+new_width);
    $('#textarea_container, #testline').css('width', new_width);
    fix_needed = true;
  }
  $a.remove();
  $b.remove();
  return fix_needed;
}
var ch_is_broken = fix_ch_unit();
if(ch_is_broken) {
  $(window).on('resize', function() {
    fix_ch_unit();
  });
}

function wrappable_file_name_html(f) {
  // Dot is sometimes used as a separator but sometimes as an extension,
  // and it would look poor to wrap at short extensions,
  // so only wrap at '.' when there are enough characters after it.
  // Wrap after regular separators and before dots for aesthetic reasons.
  return _.escape(f).replace(/(?:[-_\/]|(?=\..{6}))/g, '$&<wbr>');
}

// A "set" here is an object with every key/value pair having
// the 'value' be 'true'. Underscore.js's set operations on arrays
// have poor asymptotic speed.
function to_set(enumerable) {
  var result = {};
  _.each(enumerable, function(member) {
    if(!_.isString(member) && !_.isNumber(member)) {
      throw("Bad type in conversion to set." +
               (_.isBoolean(member) ? " Is it already a set?" : ""));
    }
    result[member] = true;
  });
  return result;
}
function set_difference(minuend, subtrahend) {
  var result = {};
  _.each(minuend, function(member) {
    if(!subtrahend[member]) {
      result[member] = true;
    }
  });
  return result;
}
function set_sorted(set) {
  return _.sortBy(_.keys(set))
}
function set_size(set) {
  return _.size(set);
}

function display_editable_files() {
  var $editable_files = $('#editable_files');
  $editable_files.empty();
  _.each(set_sorted(state.editable_files), function(f) {
    var $a = $('<a/>').attr({
        'href': '#'+f,
        'data-filename': f
      }).html(wrappable_file_name_html(f));
    if(f === state.current_file) {
      $a.addClass('current-file');
    }
    $editable_files.append($a);
  });
}

function display_context_name() {
  var title = state.context_name;
  if(state.current_file != null) {
    title += '/' + state.current_file;
  }
  $('title').text(title);
  $('#context_name').html(wrappable_file_name_html(state.context_name));
}

// (display_editable_files() does this implicitly, so no need to
//  call this if you call that)
function display_which_file_is_current() {
  var $file_lines = $('#editable_files > a');
  $file_lines.removeClass('current-file');
  if(state.current_file != null) {
    ($file_lines.
      filter('[data-filename='+escape_for_css_selector_attr_value(state.current_file)+']').
      addClass('current-file'));
  }
}

function load_status(is_initial_load) {
  return $.ajax({
    url: '/status?'+cachebuster(),
    method: 'POST',
    headers: auth_headers(),
    success: function(data) {
      console.log(data);
      state.context_name = data.context_name;
      state.default_file_name = data.default_file_name;
      display_context_name();
      var all_old_files = state.editable_files;
      var all_new_files = to_set(data.editable_files);
      if(!_.isEqual(all_old_files, all_new_files)) {
        state.editable_files = all_new_files;
        display_editable_files();
        if(is_initial_load) {
          // this will lead to reload_soon_for_dragon_naturallyspeaking
          load(state.default_file_name);
        } else {
          // links need to be created before DOMReady
          reload_soon_for_dragon_naturallyspeaking();
        }
      }
    }
  });
}

$('#editable_files').on('click', 'a', function(e) {
  e.preventDefault();
  e.stopPropagation();
  var f = $(this).attr('data-filename');
  console.log(f);
  load(f);
});

// Firefox has a text wrapping bug on very long lines sometimes
// (try an SVG)
// where it doesn't even realize that it's reporting a
// scrollHeight value that is lower than it should be.
// It wrapped some lines earlier/more than it usually does and
// forgot about that.  It forgot so thoroughly that I haven't
// yet found a way to check directly whether I need to trigger
// the reflow or not, so do it all the time (despite that it
// wastes a bit of time).
//
// Somehow, this code triggers a reflow that fixes it
// (tested on Firefox 40 on Linux).
function fix_reflow_bugs() {
  if(navigator.userAgent.indexOf('Gecko/') !== -1) {
    // say hi to the event loop before doing this,
    // so that it works (apparently)
    setTimeout(function(){
      // save and restore selection
      var selstart = editor.selectionStart;
      var selend = editor.selectionEnd;
      var seldir = editor.selectionDirection;
      // Make a type of change that will avoid Firefox's
      // optimizations where it detects whether anything
      // happened to the textarea, and does nothing if
      // it thinks nothing happened.
      var val = editor.value;
      editor.value = ' '+val;
      editor.value = val;
      // restore selection
      editor.setSelectionRange(selstart, selend, seldir);
    }, 0);
  }
}

function escape_for_css_selector_attr_value(str) {
  // see http://www.w3.org/TR/CSS21/syndata.html#strings
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// "total" as in "always has a meaningful return value"
function total_current_file() {
  if(state.current_file != null) {
    if(state.current_file === '') {
      console.log("bug? state.current_file value is empty string");
    }
    return state.current_file;
  } else {
    return '';
  }
}

function save_selection_location() {
  var file = total_current_file();
  state.remembered_selections[file] = {
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
    selectionDirection: editor.selectionDirection
  };
}
function restore_selection_location() {
  var file = total_current_file();
  if(state.remembered_selections[file]) {
    editor.setSelectionRange(
      state.remembered_selections[file].selectionStart,
      state.remembered_selections[file].selectionEnd,
      state.remembered_selections[file].selectionDirection
    );
  } else {
    editor.setSelectionRange(0, 0);
  }
}

function load(f) {
  if(f !== state.current_file) {
    if(state.saving.trying_to_save) {
      try_save();
      // try again in 300ms, otherwise let the user click again...
      setTimeout(function() {
        if(!state.saving.trying_to_save) {
          load(f);
        }
      }, 300);
    } else {
      $.ajax({
         url: '/get_file_contents?'+cachebuster(),
         method: 'POST',
         headers: _.assign(
           {'X-File': f},
           auth_headers()),
         success: function(data) {
           if(editor != null) {
             save_selection_location();
             $(editor).blur();
           }
           state.current_file = f;
           state.saving.latest_time_that_the_server_has_all_our_data = state.saving.last_sync_success = Date.now();

           state.textarea_value = data;
           set_textarea_contents(data);
           adjust_editor_height(true);
           restore_selection_location();
           fix_reflow_bugs();

           $(editor).focus();
           display_which_file_is_current();
           load_status().always(function() {
             // textareas need to be created before DOMReady
             // but, wait for load_status because it too may
             // need the page to be reloaded, and better to
             // only reload it once if we can
             reload_soon_for_dragon_naturallyspeaking();
           });
         }
      });
    }
  }
}

function get_token() {
  var token_field = document.getElementById('token');
  var done = false;
  function got_input(recur) {
    if(done){return;}
    state.auth_token = token_field.value;
    test_auth(function() {
        if(done){return;}
        done = true;
        token_field.removeEventListener('input', got_input);
        token_field.value = '';
        $('#ask-for-token').remove();
        // We now have to load status before loading textarea contents
        // because the status tells us what file to request.
        // (Note if editing this to do them in parallel, see comments below
        // about how this is difficult.)
        load_status(true);
        // load_status is currently called by load and
        // we can't call both at once here reliably because load()
        // might finish first and then have us call
        // reload_soon_for_dragon_naturallyspeaking()
        // which would terminate any outstanding ajax requests.
        // I could instead change reload_soon_... to use
        // $(document).ajaxStop, with some finickiness.
        // https://stackoverflow.com/questions/3148225/jquery-active-function
        // load_status();
        // load();
      },
      // try again a short while later, because sometimes
      // the 'input' event arrives before the text does,
      // apparently (at least in Firefox 40 on Linux,
      // pasting into the text field).
      (recur ? undefined : function() {
        setTimeout(function() {
          got_input(true);
        }, 100);
    }));
  }
  got_input(); // in case no token is required (todo, serve different html in that case instead?)
  token_field.addEventListener('input', got_input);
  $('#ask-for-token').show();
  $('#token').focus();
}

function reload_while_keeping_state(force_reload_html_from_server) {
  if(editor != null) {
    save_selection_location();
    state.textarea_value = editor.value;
  }
  if(state.saving.save_req != null) {
    state.saving.save_req.abort();
    state.saving.save_req = null;
  }
  if(state.saving.save_interval != null) {
    clearInterval(state.saving.save_interval);
    state.saving.save_interval = null;
  }
  window.removeEventListener('beforeunload', unsaved_beforeunload);
  sessionStorage.setItem('hilarious_editor_state', JSON.stringify(state));
  location.reload(force_reload_html_from_server);
}
window.reload_while_keeping_state = reload_while_keeping_state;
// Run right now, before DOMReady so that Dragon NaturallySpeaking will
// be able to notice any links that we render now.
(function(){
var stateJSON;
if(stateJSON = sessionStorage.getItem('hilarious_editor_state')) {
  sessionStorage.removeItem('hilarious_editor_state');
  state = JSON.parse(stateJSON);
  if(state.textarea_value != null) {
    set_textarea_contents(state.textarea_value);
    //delete state.textarea_value;
    adjust_editor_height(true);
    restore_selection_location();
    fix_reflow_bugs();
  }
  display_context_name();
  display_editable_files();
  $('#ask-for-token').remove();
  if(editor != null) {
    $(editor).focus();
  }
  if(state.saving.trying_to_save) {
    try_save();
  }
} else {
  get_token();
}
}());
$('#notes').click(function(){
  reload_while_keeping_state(true);
});

}());