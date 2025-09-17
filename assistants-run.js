/**
 * OpenAI Assistant Run Handler
 * Handles Assistant runs with proper tool call processing
 */

const OpenAI = require('openai');
const { postLeadToCRM, notifyLead } = require('./crm-webhook-handler');
const { leadHash } = require('./helpers/idempotency');

class AssistantRunHandler {
    constructor() {
        this.openai = null;
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            console.log('✅ Assistant Run Handler initialized');
        } else {
            console.warn('⚠️ OPENAI_API_KEY not set. Assistant runs disabled.');
        }
    }

    /**
     * Run Assistant with proper tool call handling
     * @param {Object} params - Run parameters
     * @param {string} params.userText - User message
     * @param {string} params.assistantId - Assistant ID (defaults to env var)
     * @param {string} params.threadId - Existing thread ID (optional)
     * @returns {Promise<Object>} - Run result
     */
    async runAssistant({ userText, assistantId = process.env.OPENAI_ASSISTANT_ID, threadId = null }) {
        if (!this.openai) {
            throw new Error('OpenAI client not initialized');
        }

        try {
            // Create or get thread
            let currentThreadId = threadId;
            if (!currentThreadId) {
                const thread = await this.openai.beta.threads.create();
                currentThreadId = thread.id;
                console.log(`🧵 Created new thread: ${currentThreadId}`);
            }

            // Add user message to thread
            await this.openai.beta.threads.messages.create(currentThreadId, {
                role: 'user',
                content: userText
            });

            // Create run
            let run = await this.openai.beta.threads.runs.create(currentThreadId, {
                assistant_id: assistantId
            });

            console.log(`🏃 Created run: ${run.id} for thread: ${currentThreadId}`);

            // Poll run status and handle tool calls
            while (true) {
                run = await this.openai.beta.threads.runs.retrieve(currentThreadId, run.id);
                console.log(`🔄 Run status: ${run.status}`);

                if (run.status === 'requires_action') {
                    const outputs = [];
                    for (const call of run.required_action.submit_tool_outputs.tool_calls) {
                        if (call.function.name === 'submit_lead') {
                            // Handle submit_lead tool call
                            const result = await this.handleSubmitLeadToolCall(call);
                            outputs.push({
                                tool_call_id: call.id,
                                output: JSON.stringify(result)
                            });
                        } else {
                            // Handle other tool calls
                            outputs.push({
                                tool_call_id: call.id,
                                output: JSON.stringify({ ok: true })
                            });
                        }
                    }
                    
                    await this.openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, {
                        tool_outputs: outputs
                    });
                    continue;
                }

                if (run.status === 'queued' || run.status === 'in_progress') {
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }

                break;
            }

            // Get the latest assistant message
            const messages = await this.openai.beta.threads.messages.list(currentThreadId, {
                order: 'desc',
                limit: 1
            });
            
            const last = messages.data[0];
            let text = '';
            if (last && last.role === 'assistant') {
                for (const p of last.content) {
                    if (p.type === 'text') {
                        text += p.text.value;
                    }
                }
            }

            return {
                status: run.status,
                text: text.trim() || 'Thanks for your message!',
                threadId: currentThreadId,
                runId: run.id
            };

        } catch (error) {
            console.error('❌ Error in Assistant run:', error);
            throw error;
        }
    }

    /**
     * Handle submit_lead tool call
     * @param {Object} call - Tool call object
     * @returns {Promise<Object>} - Tool call result
     */
    async handleSubmitLeadToolCall(call) {
        try {
            const args = JSON.parse(call.function.arguments || '{}');
            
            // Normalize / enrich without trusting model for source
            const lead = {
                ...args,
                source: 'chat_conversation',
                full_name: args.full_name || [args.first_name, args.last_name].filter(Boolean).join(' '),
            };

            // Optional: map to CRM expected keys if different
            if (args.origin) lead.origin_address = args.origin;
            if (args.destination) lead.destination_address = args.destination;
            
            // POST to CRM (primary) and optional notification
            const crm = await postLeadToCRM(lead);
            try { 
                await notifyLead({ 
                    event: 'new_lead', 
                    source: lead.source, 
                    full_name: lead.full_name, 
                    phone: lead.phone, 
                    crm_status: crm.ok ? 'accepted' : 'failed' 
                }); 
            } catch (notifyError) {
                console.warn('⚠️ Notification failed:', notifyError.message);
            }

            console.log(`✅ Lead submitted via Assistant tool call: ${lead.full_name}`);
            return { ok: crm.ok };

        } catch (error) {
            console.error('❌ Error in submit_lead tool call:', error);
            return { ok: false, error: error.message };
        }
    }
}

module.exports = AssistantRunHandler;
