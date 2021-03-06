(function(){
"use strict";

if(!window.hilarious) { window.hilarious = {}; }

hilarious.reload_page_as_needed_for_dragon_naturallyspeaking = (window.annyang == null);
hilarious.attempt_to_auto_indent_when_user_enters_a_newline = true;

function reload_soon_for_dragon_naturallyspeaking() {
  if(hilarious.reload_page_as_needed_for_dragon_naturallyspeaking) {
    setTimeout(function(){
      reload_while_keeping_state();
    }, 0);
  }
}

var dragon_still_waiting_before_changing_search_rows = (
  hilarious.reload_page_as_needed_for_dragon_naturallyspeaking);

function escape_for_css_selector_attr_value(str) {
  // see http://www.w3.org/TR/CSS21/syndata.html#strings
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function escape_for_js_regexp(str) {
  // from http://stackoverflow.com/a/3561711
  // which escapes - and / and everything in escapeRegExp in
  // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

var editor = hilarious.editor = null;

var state = hilarious.state = {
  auth_token: null,

  current_file: null,

  context_name: '',

  default_file_name: null,

  // filename: true
  editable_files: {},

  // filename: { selectionStart: _, selectionEnd: _, selectionDirection: _}
  remembered_selections: {},
  
  // filename: [x, y]
  remembered_scroll_positions: {},

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

//cached (for some reason):
// line_code_unit_indexes:
// Array.
// keys: line numbers starting at 0, and one-past-the-and
// values: the index into editor.value at the beginning of that line
//   (indexes are in UTF-16 code units, per javascript).
var line_code_unit_indexes = null;

var intended_editor_width = 100;

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
  $('#textarea_container').empty(); // probably redundant

  var new_textarea = $(
    '<textarea' +
      ' id="' + _.uniqueId('textarea_') + '"' +
      ' spellcheck="false"' +
      '>' +
      _.escape(text) +
      '</textarea>'
      )[0];

  $('#textarea_container').append(new_textarea);

  editor = hilarious.editor = new_textarea;
}


function adjust_editor_height_for_dragon(no_need_to_reload_page_for_dragon) {
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
  if(hilarious.reload_page_as_needed_for_dragon_naturallyspeaking) {
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
}
$('#textarea_container').on('input', 'textarea', editor_input);

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
  if(hilarious.attempt_to_auto_indent_when_user_enters_a_newline) {
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
  var end_idx_of_previous_line = 0;
  line_code_unit_indexes = [];
  _.each(textarea_lines, function(line, idx) {
    var lineno = idx + 1;
    line_code_unit_indexes.push(end_idx_of_previous_line);
    // +1 for the \n
    end_idx_of_previous_line += line.length + 1;
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
  line_code_unit_indexes.push(end_idx_of_previous_line);
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
  
  
  /*var html = Prism.highlight(state.textarea_value, Prism.languages.rust, 'rust');
  console.log("foo", html);*/
  /*$(".syntax_highlighting").addClass("language-rust");
  $(".syntax_highlighting>code").addClass("language-rust").text(state.textarea_value);
  Prism.highlightAll(true);*/
}
var debounced_compute_line_numbers = _.debounce(compute_line_numbers, 50);

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
var tab_key_num = 9;
function editor_keydown(e) {
  if(e.which === page_up_key_num || e.which === page_down_key_num) {
    e.preventDefault();
    e.stopPropagation();
    page_updown(e.which === page_down_key_num);
  }
}
var page_updown = hilarious.page_updown = function(down) {
  var page_height = window.innerHeight;
  var scroll_magnitude = page_height - 3 * textarea_line_height();
  var scroll_amount = (down ? scroll_magnitude : -scroll_magnitude);
  window.scrollBy(0, scroll_amount);
};

// Make (shift)-tabbing to the textarea not delete your cursor position:
// - IE puts the cursor at the end of the textarea
// - Chrome puts the cursor at the beginning of the textarea
// - Firefox, thankfully, doesn't move the cursor
var tab_saved_selection_location = null;
var tab_saved_time = null;
function document_keydown(e) {
  if(e.which === tab_key_num) {
    tab_saved_selection_location = editor_selection_location();
    tab_saved_time = Date.now();
  }
}
function possibly_restore_editor_selection_location() {
  if(tab_saved_selection_location != null) {
    var new_sel = editor_selection_location();
    if(!equal_selection_locations(new_sel, tab_saved_selection_location)) {
      set_editor_selection_location(tab_saved_selection_location);
      tab_saved_selection_location = null;
      tab_saved_time = null;
    }
  }
}
function document_keyup(e) {
  if(e.which === tab_key_num) {
    possibly_restore_editor_selection_location();
    tab_saved_selection_location = null;
    tab_saved_time = null;
  }
}
// (selectionchange only fires on the document element)
function document_selectionchange(e) {
  if(tab_saved_time != null) {
    // It's possible for there to be a keydown without a keyup
    // -- the user can switch to a non-browser window while holding
    // down tab -- so guess this happened based on time passing.
    if(tab_saved_time + 5000 > Date.now()) {
      possibly_restore_editor_selection_location();
      // without a delay, this works for Chrome but not IE
      //setTimeout(function() {
      //  set_editor_selection_location(tab_saved_selection_location);
      //}, 1);
    } else {
      tab_saved_selection_location = null;
      tab_saved_time = null;
    }
  }
}

$('#textarea_container').on('keydown', 'textarea', editor_keydown);
$(document).on('keydown', document_keydown);
$(document).on('keyup', document_keyup);
$(document).on('selectionchange', document_selectionchange);

function fix_ch_unit() {
  var fix_needed = false;
  var font_size_str = $('#testline').css('font-size');
  var font_size = +font_size_str.replace(/px$/, '');
  var zeroes = '0'.repeat(intended_editor_width);
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
  return _.escape(f).replace(/(?:[-_\\\/]|(?=\..{6}))/g, '$&<wbr>');
}

hilarious.display_editable_files = function() {
  var $editable_files = $('#editable_files');
  $editable_files.empty();
  _.each(hilarious.algo.set_sorted(state.editable_files), function(f) {
    var $a = $('<a/>').attr({
        'href': '#'+f,
        'data-filename': f
      }).html(wrappable_file_name_html(f));
    if(f === state.current_file) {
      $a.addClass('current-file');
    }
    $editable_files.append($a);
  });
  if(!dragon_still_waiting_before_changing_search_rows) {
    search_input();
  }
};

// Arbitrarily use NATO phonetic alphabet.
// Leaving out some of the NATO phonetic alphabet that
// we empirically had more trouble with, since we don't
// need as many as 26 of them.
var distinguishable_words = [
    'Bravo', 'Charlie', 'Foxtrot', 'Hotel', 'India', 'Juliett', 'Lima',
    'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra',
    'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee'
    ];

// initial so that Dragon will recognize these as links
function initial_display_choices() {
  var $choices = $('#choices');
  _.each(distinguishable_words, function(word, i) {
    $choices.append($('<a>')
      .attr('href', 'javascript:;')
      .append($('<span>').addClass('name').text(word))
      .append($('<span>').addClass('sep'))
      .append($('<span>').addClass('val'))
      );
  });
}
initial_display_choices();

// arguments should be the same length
function display_choices(choice_ids, choice_htmls) {
  // Keep the DOM elements around in case the accessibility technology
  // does better that way
  //var $choices = $('#choices');
  var len = choice_ids.length;
  if(len !== choice_htmls.length) {
    throw("display_choices: lengths differ");
  }
  $('#choices > a').each(function(index) {
    var active = (index < len);
    var val = (active ? choice_htmls[index] : "");
    var sep = (active ? ': ' : '');
    $('.sep', this).text(sep);
    $('.val', this).html(val);
    $(this).attr('href', (active ? 'javascript:;' : null));
    $(this).attr('data-val', (active ? choice_ids[index] : null));
  });
}

var $search_input = $('#search_input');
function search_input(e) {
  var searched = $search_input.val();
  var searcheds = _.filter(searched.split(/[ \t\r\n]/), function(s) {
    return s !== '';
  });
  var searched_regexps = _.map(searcheds, function(s) {
    return new RegExp(escape_for_js_regexp(s), 'i');
  });
  var found = _.filter(_.keys(state.editable_files).sort(), function(f) {
    return _.every(searched_regexps, function(s) {
      return s.test(f);
    });
  });
  var found_common_prefix = hilarious.algo.common_prefix(found);
  var found_common_prefix_len = found_common_prefix.length;
  var show_found = _.map(found, function(f) {
    return f.substring(found_common_prefix_len);
  });

  $('#choices_heading').html("in " + wrappable_file_name_html(found_common_prefix));

  display_choices(found, _.map(show_found, wrappable_file_name_html));
}
$search_input.on('input', search_input);

// Wait until noticeably after DOMLoad in the hopes that Dragon
// will do its processing of the page before this happens. We want
// Dragon to see the links with just the base text in them, and
// to see as many as fit on the page with each taking up only a
// single line (long values can make them take up multiple lines).
if(hilarious.reload_page_as_needed_for_dragon_naturallyspeaking) {
  $(function() {
    setTimeout(function() {
      dragon_still_waiting_before_changing_search_rows = false;
      search_input();
    }, 1500);
  });
} else {
  // initialize if needed (though the more useful initialization will come
  // when hilarious.display_edited_files calls search_input after the
  // status is loaded.)
  search_input();
}


var $go_to_line_input = $('#go_to_line_input');
var $select_lines_input = $('#select_lines_input');
function line_number_from_text(text) {
  var val = text.trim();
  var min_line = 1;
  var max_line = line_code_unit_indexes.length - 1;
  var after_max_line = line_code_unit_indexes.length;
  var line_number = null;
  // $: last line, as in vim, but after the end because that's
  // probably more useful?
  if(val == '$') {
    return after_max_line;
  } else if(
      /^[0-9]+$/.test(val)
    ) {
    var line_number = +val;
    if(line_number < min_line) {
      line_number = min_line;
    }
    if(line_number > after_max_line) {
      line_number = after_max_line;
    }
    return line_number;
  } else {
    return null;
  }
}
// "3" -- range includes all of line three
// "3-5" -- range includes all of lines three, four and five
// "5-3" -- same as "3-5", currently
function line_range_from_text(text) {
  var min_line = 1;
  var max_line = line_code_unit_indexes.length - 1;
  var after_max_line = line_code_unit_indexes.length;
  var line_range;
  if(/-/.test(text)) {
    var beginendtexts = text.split(/-+/);
    if(beginendtexts.length !== 2) {
      return null;
    }
    line_range = beginendtexts.map(line_number_from_text).sort();
  } else {
    var line_number = line_number_from_text(text);
    line_range = [line_number, line_number];
  }
  if(line_range[0] == null || line_range[1] == null) {
    return null;
  }
  if(line_range[0] < min_line) {
    line_range[0] = min_line;
  }
  if(line_range[1] > max_line) {
    line_range[1] = max_line;
  }
  return line_range;
}
function go_to_line() {
  var line_number = line_number_from_text($go_to_line_input.val());
  if(line_number != null) {
    $(editor).focus();
    set_editor_selection_location({
      selectionStart: line_code_unit_indexes[line_number - 1],
      selectionEnd:   line_code_unit_indexes[line_number - 1]
    });
    save_selection_location();
  }
}
function select_lines() {
  // line_range is an array [begin, end]
  var line_range = line_range_from_text($select_lines_input.val());
  if(line_range != null) {
    $(editor).focus();
    set_editor_selection_location({
      selectionStart: line_code_unit_indexes[line_range[0] - 1],
      selectionEnd:   line_code_unit_indexes[line_range[1]]
    });
    save_selection_location();
  }
}
var enter_key_num = 13;
_.each([
  { $input: $go_to_line_input, action: go_to_line },
  { $input: $select_lines_input, action: select_lines }
  ], function(d) {
  // Dragon triggers a paste event for the whole series of numbers you put in,
  // so automatically going without submit in that case is convenient.
  // However, it is very inconvenient if you are constructing your
  // field out of pieces.  Tradeoff.
  d.$input.on('paste', function() {
    // https://stackoverflow.com/questions/13895059/how-to-alert-after-paste-event-in-javascript
    setTimeout(d.action, 0);
  });
  // I tried using a <form> instead of keydown 'enter' event so that
  // all methods of form submission that a user-agent provides,
  // whatever they may be, will work.
  // Sadly, using <form> seemed to confuse Dragon.
  d.$input.on('keydown', function(e) {
    // https://stackoverflow.com/questions/11365632/how-to-detect-when-the-user-presses-enter-in-an-input-field
    if(e.which === enter_key_num) {
      // preventDefault so that the keyup does not input
      // an enter character to the editor textarea.
      // Alternately I could have this event detect keyup,
      // but that would mean a bit more latency to the user
      // who presses and releases Enter, which felt very
      // slightly confusing to me.
      e.preventDefault();
      d.action();
    }
  });
});



// TODO should I still show the context name somehow? maybe by formatting
// a portion of the current file differently that's part of the context name?
hilarious.display_context_name = function() {
  var current_file_or_context = (
    (state.current_file != null)
      ? state.current_file
      : state.context_name);
  // Don't change the page title if no change is needed.
  // Some things listen for page-title change, like Firefox
  // pinned tab notifications (though this code might be
  // unnecessarily cautious).
  if($('title').text() !== current_file_or_context) {
    $('title').text(current_file_or_context);
    $('#context_name').html(wrappable_file_name_html(current_file_or_context));
  }
};

// (display_editable_files() does this implicitly, so no need to
//  call this if you call that)
function display_which_file_is_current() {
  hilarious.display_context_name();
  var $file_lines = $('#editable_files > a');
  $file_lines.removeClass('current-file');
  if(state.current_file != null) {
    ($file_lines.
      filter('[data-filename='+escape_for_css_selector_attr_value(state.current_file)+']').
      addClass('current-file'));
  }
}

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

function equal_selection_locations(sel1, sel2) {
  return (
    sel1.selectionStart === sel2.selectionStart &&
    sel1.selectionEnd === sel2.selectionEnd &&
    sel1.selectionDirection === sel2.selectionDirection);
}
function editor_selection_location() {
  return {
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
    selectionDirection: editor.selectionDirection
  };
}
function set_editor_selection_location(sel) {
  editor.setSelectionRange(
    sel.selectionStart,
    sel.selectionEnd,
    sel.selectionDirection
  );
}
function save_selection_location() {
  var file = total_current_file();
  state.remembered_selections[file] = editor_selection_location();
}
function restore_selection_location() {
  var file = total_current_file();
  if(state.remembered_selections[file]) {
    set_editor_selection_location(state.remembered_selections[file]);
  } else {
    editor.setSelectionRange(0, 0);
  }
}
function save_scroll_location() {
  var file = total_current_file();
  state.remembered_scroll_positions[file] = [window.pageXOffset, window.pageYOffset];
}
function restore_scroll_location() {
  var file = total_current_file();
  var scroll = state.remembered_scroll_positions[file];
  if (scroll) {
    window.scrollTo(scroll[0], scroll[1]);
  }
}

hilarious.loaded_file = function(filename, contents) {
  if(editor != null) {
    save_selection_location();
    save_scroll_location()
    $(editor).blur();
  }
  state.current_file = filename;
  state.saving.latest_time_that_the_server_has_all_our_data = state.saving.last_sync_success = Date.now();

  state.textarea_value = contents;
  set_textarea_contents(contents);
  adjust_editor_height(true);
  restore_selection_location();
  restore_scroll_location();
  fix_reflow_bugs();

  $(editor).focus();
  display_which_file_is_current();

  reload_soon_for_dragon_naturallyspeaking();
};

function reload_while_keeping_state(force_reload_html_from_server) {
  console.log("preparing for special reload");
  if(editor != null) {
    save_selection_location();
    state.textarea_value = editor.value;
  }
  hilarious.abort_saving_for_impending_special_lossless_reload();
  sessionStorage.setItem('hilarious_editor_state', JSON.stringify(state));
  location.reload(force_reload_html_from_server);
}
window.reload_while_keeping_state = reload_while_keeping_state;
// Run right now, before DOMReady so that Dragon NaturallySpeaking will
// be able to notice any links that we render now.
(function(){
var stateJSON = sessionStorage.getItem('hilarious_editor_state');
if(stateJSON != null) {
  console.log("restoring from special reload");
  sessionStorage.removeItem('hilarious_editor_state');
  hilarious.algo.clear_object(state);
  _.extendOwn(state, JSON.parse(stateJSON));
  if(state.textarea_value != null) {
    set_textarea_contents(state.textarea_value);
    //delete state.textarea_value;
    adjust_editor_height(true);
    restore_selection_location();
    // Note: it doesn't work to restore the scroll position until AFTER it
    // actually redisplays the text, so wait until after it redisplays
    // (requestAnimationFrame goes BEFORE the next repaint)
    window.requestAnimationFrame(function(){
      window.requestAnimationFrame(function(){
        restore_scroll_location();
      });
    });
    fix_reflow_bugs();
  }
  hilarious.display_context_name();
  hilarious.display_editable_files();
  $('#ask-for-token').remove();
  if(editor != null) {
    $(editor).focus();
  }
}
}());
$('#notes').click(function(){
  reload_while_keeping_state(true);
});

}());
