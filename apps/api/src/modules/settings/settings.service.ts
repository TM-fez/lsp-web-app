import { env } from '../../config/env.js';
import { DEFAULT_COMPANY_NAME } from '../../core/settings/appSettings.js';
import type { SettingsRepository } from './settings.repository.js';
import type { SettingsRequestMeta, UpdateSettingsDTO } from './settings.types.js';

export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  /**
   * The stored settings plus the values in force when a field is empty, so the screen can
   * say "7 days (default)" rather than showing a blank and leaving the owner guessing.
   */
  async get() {
    const row = await this.repo.get();
    return {
      ...row,
      defaults: {
        company_name: DEFAULT_COMPANY_NAME,
        invoice_terms_days: env.INVOICE_TERMS_DAYS,
        website_hold_hours: env.WEBSITE_PENDING_TTL_HOURS,
      },
    };
  }

  async update(dto: UpdateSettingsDTO, meta: SettingsRequestMeta) {
    await this.repo.update(dto, meta);
    return this.get();
  }
}
