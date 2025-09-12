const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Create necessary directories
const createDirectories = () => {
    const dirs = ['./auth', './logs'];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

createDirectories();

// WhatsApp client instances
const clients = new Map();

// Enhanced logging
const log = (level, message, instanceId = null) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${instanceId ? `[${instanceId}] ` : ''}${message}`;
    console.log(logMessage);
    
    // Write to log file
    const logDir = './logs';
    const logFile = path.join(logDir, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logMessage + '\n');
};

class WhatsAppAPI {
    constructor(instanceId) {
        this.instanceId = instanceId;
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: instanceId,
                dataPath: `./auth/${instanceId}`
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });

        this.isReady = false;
        this.qrCode = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.client.on('qr', (qr) => {
            log('info', 'QR Code generated', this.instanceId);
            qrcode.generate(qr, { small: true });
            this.qrCode = qr;
        });

        this.client.on('ready', () => {
            log('info', 'Client is ready!', this.instanceId);
            this.isReady = true;
            this.qrCode = null;
        });

        this.client.on('authenticated', () => {
            log('info', 'Client authenticated', this.instanceId);
        });

        this.client.on('auth_failure', (msg) => {
            log('error', `Authentication failed: ${msg}`, this.instanceId);
            this.qrCode = null;
        });

        this.client.on('disconnected', (reason) => {
            log('warn', `Client disconnected: ${reason}`, this.instanceId);
            this.isReady = false;
            this.qrCode = null;
        });
    }

    async initialize() {
        try {
            await this.client.initialize();
            log('info', 'Client initialization started', this.instanceId);
            return { success: true };
        } catch (error) {
            log('error', `Failed to initialize: ${error.message}`, this.instanceId);
            return { success: false, error: error.message };
        }
    }

    async sendMessage(to, message) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            let chatId;
            if (to.includes('@')) {
                chatId = to;
            } else {
                const cleanNumber = to.replace(/\D/g, '');
                chatId = `${cleanNumber}@c.us`;
            }

            const result = await this.client.sendMessage(chatId, message);
            
            log('info', `Message sent to ${to}`, this.instanceId);
            
            return {
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
                to: result.to
            };
        } catch (error) {
            log('error', `Failed to send message: ${error.message}`, this.instanceId);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    async createGroup(groupName, participants) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            // Format participants - ensure they are in correct format
            const formattedParticipants = participants.map(participant => {
                if (participant.includes('@')) {
                    return participant;
                }
                const cleanNumber = participant.replace(/\D/g, '');
                return `${cleanNumber}@c.us`;
            });

            const group = await this.client.createGroup(groupName, formattedParticipants);
            
            log('info', `Group created: ${groupName} with ${participants.length} participants`, this.instanceId);
            
            return {
                success: true,
                groupId: group.gid._serialized,
                groupName: groupName,
                participants: formattedParticipants,
                inviteCode: group.inviteCode || null
            };
        } catch (error) {
            log('error', `Failed to create group: ${error.message}`, this.instanceId);
            throw new Error(`Failed to create group: ${error.message}`);
        }
    }

    async updateGroupSettings(groupId, settings) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            const chat = await this.client.getChatById(groupId);
            
            if (!chat.isGroup) {
                throw new Error('Chat is not a group');
            }

            const results = {};

            // Update group subject (name)
            if (settings.subject || settings.name) {
                await chat.setSubject(settings.subject || settings.name);
                results.subject = settings.subject || settings.name;
                log('info', `Group subject updated: ${settings.subject || settings.name}`, this.instanceId);
            }

            // Update group description
            if (settings.description) {
                await chat.setDescription(settings.description);
                results.description = settings.description;
                log('info', `Group description updated`, this.instanceId);
            }

            // Update group settings (messagesAdminsOnly, editGroupInfoAdminsOnly)
            if (settings.messagesAdminsOnly !== undefined) {
                await chat.setMessagesAdminsOnly(settings.messagesAdminsOnly);
                results.messagesAdminsOnly = settings.messagesAdminsOnly;
                log('info', `Messages admins only: ${settings.messagesAdminsOnly}`, this.instanceId);
            }

            if (settings.editGroupInfoAdminsOnly !== undefined) {
                await chat.setInfoAdminsOnly(settings.editGroupInfoAdminsOnly);
                results.editGroupInfoAdminsOnly = settings.editGroupInfoAdminsOnly;
                log('info', `Edit info admins only: ${settings.editGroupInfoAdminsOnly}`, this.instanceId);
            }

            return {
                success: true,
                groupId: groupId,
                updatedSettings: results
            };
        } catch (error) {
            log('error', `Failed to update group settings: ${error.message}`, this.instanceId);
            throw new Error(`Failed to update group settings: ${error.message}`);
        }
    }

    async addParticipants(groupId, participants, asAdmin = false) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            const chat = await this.client.getChatById(groupId);
            
            if (!chat.isGroup) {
                throw new Error('Chat is not a group');
            }

            // Format participants
            const formattedParticipants = participants.map(participant => {
                if (participant.includes('@')) {
                    return participant;
                }
                const cleanNumber = participant.replace(/\D/g, '');
                return `${cleanNumber}@c.us`;
            });

            // Add participants
            const result = await chat.addParticipants(formattedParticipants);
            
            // If asAdmin is true, promote them to admin
            if (asAdmin) {
                for (const participant of formattedParticipants) {
                    try {
                        await chat.promoteParticipants([participant]);
                        log('info', `Promoted ${participant} to admin`, this.instanceId);
                    } catch (error) {
                        log('warn', `Failed to promote ${participant}: ${error.message}`, this.instanceId);
                    }
                }
            }

            log('info', `Added ${participants.length} participants to group`, this.instanceId);

            return {
                success: true,
                groupId: groupId,
                addedParticipants: formattedParticipants,
                asAdmin: asAdmin,
                result: result
            };
        } catch (error) {
            log('error', `Failed to add participants: ${error.message}`, this.instanceId);
            throw new Error(`Failed to add participants: ${error.message}`);
        }
    }

    async promoteParticipants(groupId, participants) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            const chat = await this.client.getChatById(groupId);
            
            if (!chat.isGroup) {
                throw new Error('Chat is not a group');
            }

            // Format participants
            const formattedParticipants = participants.map(participant => {
                if (participant.includes('@')) {
                    return participant;
                }
                const cleanNumber = participant.replace(/\D/g, '');
                return `${cleanNumber}@c.us`;
            });

            await chat.promoteParticipants(formattedParticipants);
            
            log('info', `Promoted ${participants.length} participants to admin`, this.instanceId);

            return {
                success: true,
                groupId: groupId,
                promotedParticipants: formattedParticipants
            };
        } catch (error) {
            log('error', `Failed to promote participants: ${error.message}`, this.instanceId);
            throw new Error(`Failed to promote participants: ${error.message}`);
        }
    }

    async demoteParticipants(groupId, participants) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            const chat = await this.client.getChatById(groupId);
            
            if (!chat.isGroup) {
                throw new Error('Chat is not a group');
            }

            // Format participants
            const formattedParticipants = participants.map(participant => {
                if (participant.includes('@')) {
                    return participant;
                }
                const cleanNumber = participant.replace(/\D/g, '');
                return `${cleanNumber}@c.us`;
            });

            await chat.demoteParticipants(formattedParticipants);
            
            log('info', `Demoted ${participants.length} participants from admin`, this.instanceId);

            return {
                success: true,
                groupId: groupId,
                demotedParticipants: formattedParticipants
            };
        } catch (error) {
            log('error', `Failed to demote participants: ${error.message}`, this.instanceId);
            throw new Error(`Failed to demote participants: ${error.message}`);
        }
    }

    async getAllGroups() {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            const chats = await this.client.getChats();
            const groups = chats.filter(chat => chat.isGroup);
            
            log('info', `Retrieved ${groups.length} groups`, this.instanceId);
            
            return groups.map(group => ({
                id: group.id._serialized,
                name: group.name,
                description: group.groupMetadata?.desc || '',
                participants: group.participants?.map(p => ({
                    id: p.id._serialized,
                    isAdmin: p.isAdmin,
                    isSuperAdmin: p.isSuperAdmin
                })) || [],
                participantCount: group.participants?.length || 0,
                adminCount: group.participants?.filter(p => p.isAdmin || p.isSuperAdmin).length || 0,
                createdAt: group.groupMetadata?.creation || null,
                createdBy: group.groupMetadata?.owner || null,
                isReadOnly: group.isReadOnly,
                unreadCount: group.unreadCount,
                archived: group.archived,
                pinned: group.pinned,
                isMuted: group.isMuted,
                inviteCode: group.inviteCode || null
            }));
        } catch (error) {
            log('error', `Failed to get groups: ${error.message}`, this.instanceId);
            throw new Error(`Failed to get groups: ${error.message}`);
        }
    }

    async getGroupById(groupId) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            const chat = await this.client.getChatById(groupId);
            
            if (!chat.isGroup) {
                throw new Error('Chat is not a group');
            }

            log('info', `Retrieved group info for ${groupId}`, this.instanceId);
            
            return {
                id: chat.id._serialized,
                name: chat.name,
                description: chat.groupMetadata?.desc || '',
                participants: chat.participants?.map(p => ({
                    id: p.id._serialized,
                    isAdmin: p.isAdmin,
                    isSuperAdmin: p.isSuperAdmin
                })) || [],
                participantCount: chat.participants?.length || 0,
                adminCount: chat.participants?.filter(p => p.isAdmin || p.isSuperAdmin).length || 0,
                createdAt: chat.groupMetadata?.creation || null,
                createdBy: chat.groupMetadata?.owner || null,
                isReadOnly: chat.isReadOnly,
                unreadCount: chat.unreadCount,
                archived: chat.archived,
                pinned: chat.pinned,
                isMuted: chat.isMuted,
                inviteCode: chat.inviteCode || null,
                messagesAdminsOnly: chat.groupMetadata?.restrict || false,
                editGroupInfoAdminsOnly: chat.groupMetadata?.announce || false
            };
        } catch (error) {
            log('error', `Failed to get group: ${error.message}`, this.instanceId);
            throw new Error(`Failed to get group: ${error.message}`);
        }
    }

    getStatus() {
        return {
            instanceId: this.instanceId,
            isReady: this.isReady,
            hasQR: !!this.qrCode
        };
    }

    async disconnect() {
        try {
            log('info', 'Disconnecting client', this.instanceId);
            await this.client.destroy();
            return { success: true };
        } catch (error) {
            log('error', `Failed to disconnect: ${error.message}`, this.instanceId);
            return { success: false, error: error.message };
        }
    }
    async getOrCreateGroupInviteLink(groupId, forceCreate = false) {
    if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
    }

    try {
        const chat = await this.client.getChatById(groupId);
        
        if (!chat.isGroup) {
            throw new Error('Chat is not a group');
        }

        let inviteCode = null;
        let inviteLink = null;
        let created = false;

        // Try to get existing invite code first
        try {
            inviteCode = await chat.getInviteCode();
            if (inviteCode && !forceCreate) {
                inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                log('info', `Retrieved existing group invite link for ${groupId}`, this.instanceId);
            }
        } catch (error) {
            log('warn', `No existing invite code found: ${error.message}`, this.instanceId);
        }

        // If no invite code exists or forceCreate is true, create a new one
        if (!inviteCode || forceCreate) {
            try {
                // Revoke existing code first if forceCreate is true
                if (forceCreate && inviteCode) {
                    await chat.revokeInvite();
                    log('info', `Revoked existing invite code for ${groupId}`, this.instanceId);
                }
                
                // Create new invite code
                inviteCode = await chat.getInviteCode();
                inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                created = true;
                log('info', `Created new group invite link for ${groupId}`, this.instanceId);
            } catch (error) {
                log('error', `Failed to create invite code: ${error.message}`, this.instanceId);
                throw new Error(`Failed to create group invite link: ${error.message}`);
            }
        }

        return {
            success: true,
            groupId: groupId,
            inviteCode: inviteCode,
            inviteLink: inviteLink,
            created: created,
            groupName: chat.name
        };
    } catch (error) {
        log('error', `Failed to get/create group invite link: ${error.message}`, this.instanceId);
        throw new Error(`Failed to get/create group invite link: ${error.message}`);
    }
}

async revokeGroupInviteLink(groupId) {
    if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
    }

    try {
        const chat = await this.client.getChatById(groupId);
        
        if (!chat.isGroup) {
            throw new Error('Chat is not a group');
        }

        await chat.revokeInvite();
        log('info', `Revoked group invite link for ${groupId}`, this.instanceId);

        return {
            success: true,
            groupId: groupId,
            message: 'Group invite link revoked successfully',
            groupName: chat.name
        };
    } catch (error) {
        log('error', `Failed to revoke group invite link: ${error.message}`, this.instanceId);
        throw new Error(`Failed to revoke group invite link: ${error.message}`);
    }
}
}
// Get or create group invite link
app.get('/group/:groupId/invite-link', async (req, res) => {
    try {
        const { instanceId, forceCreate } = req.query;
        const { groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!instanceId) {
            return res.status(400).json({
                success: false,
                error: 'instanceId query parameter is required'
            });
        }

        const shouldForceCreate = forceCreate === 'true';
        const result = await client.getOrCreateGroupInviteLink(groupId, shouldForceCreate);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Alternative POST route for creating invite link
app.post('/group/:groupId/invite-link', async (req, res) => {
    try {
        const { instanceId, forceCreate = false } = req.body;
        const { groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!instanceId) {
            return res.status(400).json({
                success: false,
                error: 'instanceId is required in request body'
            });
        }

        const result = await client.getOrCreateGroupInviteLink(groupId, forceCreate);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Revoke group invite link
app.delete('/group/:groupId/invite-link', async (req, res) => {
    try {
        const { instanceId } = req.body;
        const { groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!instanceId) {
            return res.status(400).json({
                success: false,
                error: 'instanceId is required in request body'
            });
        }

        const result = await client.revokeGroupInviteLink(groupId);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Batch get invite links for multiple groups
app.post('/groups/invite-links/batch', async (req, res) => {
    try {
        const { instanceId, groupIds, forceCreate = false } = req.body;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!instanceId || !groupIds || !Array.isArray(groupIds)) {
            return res.status(400).json({
                success: false,
                error: 'instanceId and groupIds array are required'
            });
        }

        const results = [];
        const errors = [];

        for (const groupId of groupIds) {
            try {
                const result = await client.getOrCreateGroupInviteLink(groupId, forceCreate);
                results.push(result);
            } catch (error) {
                errors.push({
                    groupId: groupId,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            results: results,
            errors: errors,
            summary: {
                total: groupIds.length,
                successful: results.length,
                failed: errors.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// API Routes

// Create new instance
app.post('/instance/create', async (req, res) => {
    try {
        const { instanceId } = req.body;
        
        if (!instanceId) {
            return res.status(400).json({
                success: false,
                error: 'Instance ID is required'
            });
        }

        if (clients.has(instanceId)) {
            return res.status(400).json({
                success: false,
                error: 'Instance already exists'
            });
        }

        const whatsappAPI = new WhatsAppAPI(instanceId);
        clients.set(instanceId, whatsappAPI);

        await whatsappAPI.initialize();
        
        log('info', `Instance created: ${instanceId}`, instanceId);
        
        res.json({
            success: true,
            instanceId,
            message: 'Instance created successfully'
        });
    } catch (error) {
        log('error', `Failed to create instance: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get instance status
app.get('/instance/:instanceId/status', (req, res) => {
    const { instanceId } = req.params;
    const client = clients.get(instanceId);

    if (!client) {
        return res.status(404).json({
            success: false,
            error: 'Instance not found'
        });
    }

    res.json({
        success: true,
        data: client.getStatus()
    });
});

// Get QR Code
app.get('/instance/:instanceId/qr', (req, res) => {
    const { instanceId } = req.params;
    const client = clients.get(instanceId);

    if (!client) {
        return res.status(404).json({
            success: false,
            error: 'Instance not found'
        });
    }

    if (!client.qrCode) {
        return res.status(400).json({
            success: false,
            error: 'QR Code not available. Instance might be already connected.'
        });
    }

    res.json({
        success: true,
        qrCode: client.qrCode
    });
});

// Send message
app.post('/message/send', async (req, res) => {
    try {
        const { instanceId, to, message } = req.body;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'Both "to" and "message" fields are required'
            });
        }

        const result = await client.sendMessage(to, message);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// API Routes to add to your Express app


// Create group
app.post('/group/create', async (req, res) => {
    try {
        const { instanceId, groupName, participants } = req.body;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!groupName || !participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'Group name and participants array are required'
            });
        }

        const result = await client.createGroup(groupName, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add participants to group
app.post('/group/:groupId/participants/add', async (req, res) => {
    try {
        const { instanceId, participants, asAdmin = false } = req.body;
        const { groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'Participants array is required'
            });
        }

        const result = await client.addParticipants(groupId, participants, asAdmin);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Promote participants to admin
app.post('/group/:groupId/participants/promote', async (req, res) => {
    try {
        const { instanceId, participants } = req.body;
        const { groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'Participants array is required'
            });
        }

        const result = await client.promoteParticipants(groupId, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Demote participants from admin
app.post('/group/:groupId/participants/demote', async (req, res) => {
    try {
        const { instanceId, participants } = req.body;
        const { groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        if (!participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'Participants array is required'
            });
        }

        const result = await client.demoteParticipants(groupId, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update group settings
app.put('/group/:groupId/settings', async (req, res) => {
    try {
        const { instanceId, ...settings } = req.body;
        const { groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        const result = await client.updateGroupSettings(groupId, settings);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all groups
app.get('/groups/:instanceId', async (req, res) => {
    try {
        const { instanceId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        const groups = await client.getAllGroups();
        res.json({
            success: true,
            data: groups
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get group by ID
app.get('/group/:instanceId/:groupId', async (req, res) => {
    try {
        const { instanceId, groupId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        const group = await client.getGroupById(groupId);
        res.json({
            success: true,
            data: group
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete instance
app.delete('/instance/:instanceId', async (req, res) => {
    try {
        const { instanceId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        await client.disconnect();
        clients.delete(instanceId);

        // Clean up auth directory
        const authDir = `./auth/${instanceId}`;
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
        }

        log('info', `Instance deleted: ${instanceId}`);

        res.json({
            success: true,
            message: 'Instance deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'WhatsApp API Server is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/groups/:instanceId/summary', async (req, res) => {
    try {
        const { instanceId } = req.params;
        const client = clients.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Instance not found'
            });
        }

        // Always exclude participants for summary endpoint
        const groups = await client.getAllGroups(false);
        res.json({
            success: true,
            data: groups,
            meta: {
                totalGroups: groups.length,
                includeParticipants: false,
                note: "Use /groups/:instanceId?includeParticipants=true to get full participant details"
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    log('error', `API Error: ${error.message}`);
    res.status(500).json({
        success: false,
        error: error.message
    });
});

// Start server
app.listen(PORT, () => {
    log('info', `WhatsApp API Server running on port ${PORT}`);
    console.log('\n🚀 Server is ready!');
    console.log(`📱 Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    log('info', `Received ${signal}. Starting graceful shutdown...`);
    
    for (const [instanceId, client] of clients.entries()) {
        log('info', `Disconnecting instance: ${instanceId}`);
        try {
            await client.disconnect();
        } catch (error) {
            log('error', `Error disconnecting ${instanceId}: ${error.message}`);
        }
    }
    
    log('info', 'Graceful shutdown completed');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));