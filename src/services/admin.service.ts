import {
  IntentModel,
  ToolModel,
  KnowledgeModel,
} from '../database/models'

export class AdminService {
  // ==========================================
  // INTENT MANAGEMENT
  // ==========================================
  async getAllIntents() {
    return await IntentModel.findAll()
  }

  async createIntent(data: any) {
    return await IntentModel.create(data)
  }

  // ==========================================
  // TOOL MANAGEMENT
  // ==========================================
  async getAllTools() {
    return await ToolModel.findAll()
  }

  async createTool(data: any) {
    return await ToolModel.create(data)
  }

  // ==========================================
  // KNOWLEDGE MANAGEMENT
  // ==========================================
  async getAllKnowledges() {
    return await KnowledgeModel.findAll()
  }

  async createKnowledge(data: any) {
    return await KnowledgeModel.create(data)
  }
}

export const adminService = new AdminService()
