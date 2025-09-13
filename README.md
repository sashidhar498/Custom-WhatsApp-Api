
# 📱 WhatsApp API Simplified

**WhatsApp API Simplified** is a **self-hosted Node.js REST API** built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).  
It allows you to **send messages, create & manage groups, handle participants, and generate invite links** through simple HTTP requests.  

Perfect for **bots, automation, and group management** with minimal setup. 🚀  

---

## ✨ Features
- Multi-instance support (`instanceId` based)
- QR code authentication
- Send messages to individuals or groups
- Create & manage WhatsApp groups
- Add, promote, and demote participants
- Update group settings (name, description, admin-only messages, etc.)
- Generate and revoke invite links
- Retrieve group details and summaries
- Built-in logging system (`./logs`)
- Lightweight & developer-friendly REST API

---

## 📦 Installation

### 1. Clone the repository
```bash
git clone [https://github.com/sashidhar498/Custom-WhatsApp-Api](https://github.com/sashidhar498/Custom-WhatsApp-Api)
cd whatsapp-api-simplified
````

### 2. Install dependencies

```bash
npm install
```

### 3. Setup folders

```bash
npm run setup
```

This creates `auth/` and `logs/` directories.

### 4. Run the server

Development mode (with auto-restart):

```bash
npm run dev
```

Production mode:

```bash
npm start
```

By default, the server runs on **[http://localhost:3000](http://localhost:3000)**.

---

## 🔑 Authentication Flow

1. Create a new **instance** (`POST /instance/create`).
2. Fetch the **QR code** (`GET /instance/:id/qr`) and scan it using WhatsApp on your phone.
3. Once authenticated, use your `instanceId` in all API requests.

---

## 📡 API Endpoints

### 🩺 Health Check

```http
GET /health
```

Response:

```json
{
  "success": true,
  "message": "WhatsApp API Server is running",
  "timestamp": "2025-09-12T10:00:00Z",
  "uptime": 1234.56
}
```

---

### 🔧 Instance Management

**Create Instance**

```http
POST /instance/create
Content-Type: application/json

{
  "instanceId": "mybot"
}
```

**Get Status**

```http
GET /instance/mybot/status
```

**Get QR Code**

```http
GET /instance/mybot/qr
```

**Delete Instance**

```http
DELETE /instance/mybot
```

---

### 💬 Messaging

**Send Message**

```http
POST /message/send
Content-Type: application/json

{
  "instanceId": "mybot",
  "to": "919876543210",
  "message": "Hello from WhatsApp API!"
}
```

---

### 👥 Group Management

**Create Group**

```http
POST /group/create
Content-Type: application/json

{
  "instanceId": "mybot",
  "groupName": "My Friends",
  "participants": ["919876543210", "919812345678"]
}
```

**Add Participants**

```http
POST /group/:groupId/participants/add
```

**Promote Participants**

```http
POST /group/:groupId/participants/promote
```

**Demote Participants**

```http
POST /group/:groupId/participants/demote
```

**Update Group Settings**

```http
PUT /group/:groupId/settings
Content-Type: application/json

{
  "instanceId": "mybot",
  "subject": "New Group Name",
  "description": "Managed via API 🚀",
  "messagesAdminsOnly": true
}
```

**Get All Groups**

```http
GET /groups/mybot
```

**Get Group by ID**

```http
GET /group/mybot/:groupId
```

**Get Summary**

```http
GET /groups/mybot/summary
```

---

### 🔗 Invite Links

**Get/Create Invite Link**

```http
GET /group/:groupId/invite-link?instanceId=mybot&forceCreate=true
```

**POST Alternative**

```http
POST /group/:groupId/invite-link
```

**Revoke Invite Link**

```http
DELETE /group/:groupId/invite-link
```

**Batch Invite Links**

```http
POST /groups/invite-links/batch
```

---

## 📂 Project Structure

```
├── server.js        # Main API server
├── package.json     # Dependencies & scripts
├── /auth            # WhatsApp session data
└── /logs            # Daily log files
```

---

## ⚡ Tips & Best Practices

* Use **Postman** or **cURL** to test APIs quickly.
* Keep `instanceId` unique for each bot/session.
* Logs are stored in `/logs/YYYY-MM-DD.log`.
* Run in production with **PM2** or Docker for stability.

---

## 🛡️ Disclaimer

This project uses **WhatsApp Web** and is **not affiliated with WhatsApp Inc.**
Use responsibly and in compliance with WhatsApp’s [Terms of Service](https://www.whatsapp.com/legal/terms-of-service).

---

