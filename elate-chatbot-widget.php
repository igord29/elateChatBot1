<?php
/**
 * Plugin Name: Elate Moving Chatbot Widget
 * Description: Embed the Elate Moving AI chatbot on your WordPress site
 * Version: 1.0.0
 * Author: Elate Moving
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

class ElateChatbotWidget extends WP_Widget {
    
    public function __construct() {
        parent::__construct(
            'elate_chatbot_widget',
            'Elate Moving Chatbot',
            array('description' => 'AI-powered moving chatbot for lead generation')
        );
    }
    
    public function widget($args, $instance) {
        echo $args['before_widget'];
        
        if (!empty($instance['title'])) {
            echo $args['before_title'] . apply_filters('widget_title', $instance['title']) . $args['after_title'];
        }
        
        // Widget content
        $this->render_chatbot();
        
        echo $args['after_widget'];
    }
    
    public function form($instance) {
        $title = !empty($instance['title']) ? $instance['title'] : 'Chat with Dave';
        ?>
        <p>
            <label for="<?php echo $this->get_field_id('title'); ?>">Title:</label>
            <input class="widefat" id="<?php echo $this->get_field_id('title'); ?>" 
                   name="<?php echo $this->get_field_name('title'); ?>" type="text" 
                   value="<?php echo esc_attr($title); ?>">
        </p>
        <p>
            <small>This widget embeds the Elate Moving AI chatbot for lead generation.</small>
        </p>
        <?php
    }
    
    public function update($new_instance, $old_instance) {
        $instance = array();
        $instance['title'] = (!empty($new_instance['title'])) ? strip_tags($new_instance['title']) : '';
        return $instance;
    }
    
    private function render_chatbot() {
        ?>
        <div id="elate-chatbot-container" style="width: 100%; max-width: 400px; margin: 0 auto;">
            <iframe 
                src="https://elate-chat-bot1.vercel.app/chat-ui.html" 
                width="100%" 
                height="600" 
                frameborder="0"
                style="border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);"
                title="Elate Moving Chatbot">
            </iframe>
        </div>
        <?php
    }
}

// Register the widget
function register_elate_chatbot_widget() {
    register_widget('ElateChatbotWidget');
}
add_action('widgets_init', 'register_elate_chatbot_widget');

// Add shortcode support
function elate_chatbot_shortcode($atts) {
    $atts = shortcode_atts(array(
        'width' => '400px',
        'height' => '600px'
    ), $atts);
    
    return sprintf(
        '<div id="elate-chatbot-shortcode" style="width: 100%%; max-width: %s; margin: 0 auto;">
            <iframe 
                src="https://elate-chat-bot1.vercel.app/chat-ui.html" 
                width="100%%" 
                height="%s" 
                frameborder="0"
                style="border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);"
                title="Elate Moving Chatbot">
            </iframe>
        </div>',
        esc_attr($atts['width']),
        esc_attr($atts['height'])
    );
}
add_shortcode('elate_chatbot', 'elate_chatbot_shortcode');

// Add admin menu
function elate_chatbot_admin_menu() {
    add_options_page(
        'Elate Chatbot Settings',
        'Elate Chatbot',
        'manage_options',
        'elate-chatbot',
        'elate_chatbot_admin_page'
    );
}
add_action('admin_menu', 'elate_chatbot_admin_menu');

function elate_chatbot_admin_page() {
    ?>
    <div class="wrap">
        <h1>Elate Moving Chatbot</h1>
        <div class="card">
            <h2>Widget Usage</h2>
            <p>Add the "Elate Moving Chatbot" widget to your sidebar or any widget area.</p>
            
            <h2>Shortcode Usage</h2>
            <p>Use the shortcode <code>[elate_chatbot]</code> in any post, page, or widget.</p>
            <p>Optional parameters:</p>
            <ul>
                <li><code>width</code> - Widget width (default: 400px)</li>
                <li><code>height</code> - Widget height (default: 600px)</li>
            </ul>
            <p><strong>Example:</strong> <code>[elate_chatbot width="500px" height="700px"]</code></p>
            
            <h2>Direct Embed</h2>
            <p>You can also embed the chatbot directly using an iframe:</p>
            <textarea readonly style="width: 100%; height: 100px;">
<iframe 
    src="https://elate-chat-bot1.vercel.app/chat-ui.html" 
    width="400" 
    height="600" 
    frameborder="0"
    style="border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);"
    title="Elate Moving Chatbot">
</iframe>
            </textarea>
        </div>
    </div>
    <?php
}
?>
